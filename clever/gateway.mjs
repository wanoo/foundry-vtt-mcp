// gateway.mjs — hébergement Clever Cloud du serveur MCP (client natif Foundry).
//   · :8080  POST/GET/DELETE /mcp-<MCP_SECRET> → MCP « streamable HTTP »
//     (Claude Code `--transport http` et Claude Desktop « custom connector »),
//     relayé vers le serveur MCP stdio de ce dépôt (child process ../build/server.js).
//   · GET /health (:8080) → sonde Clever.
// Secret MCP dans l'URL (Claude Desktop ne pose pas d'en-têtes custom).
//
// Env requis  : MCP_SECRET, FOUNDRY_CREDENTIALS_JSON (tableau JSON, écrit dans
//               config/foundry_credentials.json au boot).
// Ce fichier a son propre package.json (SDK MCP ≥1.17 pour streamableHttp) —
// le serveur, lui, reste sur son SDK 0.6 : les deux ne partagent que le stdio.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);
const MCP_SECRET = process.env.MCP_SECRET;
if (!MCP_SECRET) {
  console.error('MCP_SECRET est requis (env).');
  process.exit(1);
}
const MCP_PATH = `/mcp-${MCP_SECRET}`;

// --- 1. Serveur MCP stdio en child process -------------------------------------
const credsPath = join(ROOT, 'config', 'foundry_credentials.json');
mkdirSync(dirname(credsPath), { recursive: true });
writeFileSync(credsPath, process.env.FOUNDRY_CREDENTIALS_JSON ||
  '[{"_id":"placeholder","hostname":"localhost","userid":"x","password":"x"}]');
const client = new Client({ name: 'clever-gateway', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [join(ROOT, 'build', 'server.js')],
  env: { ...process.env, FOUNDRY_CREDENTIALS: credsPath },
  stderr: 'inherit',
}));
console.log('[gateway] serveur MCP stdio démarré');

// --- 2. Fabrique de sessions MCP HTTP (une par client Claude) ------------------
function makeSession() {
  const server = new Server(
    { name: 'foundry-mcp-clever', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  // Passe-plat : la liste et l'appel d'outils sont relayés au serveur stdio.
  server.setRequestHandler(ListToolsRequestSchema, async () => client.listTools());
  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    client.callTool({ name: req.params.name, arguments: req.params.arguments || {} })
  );
  return server;
}

const sessions = new Map(); // sessionId -> transport
async function handleMcp(req, res) {
  const sid = req.headers['mcp-session-id'];
  let transport = sid ? sessions.get(sid) : undefined;
  if (!transport) {
    if (req.method !== 'POST') { res.writeHead(400); return res.end('session inconnue'); }
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => sessions.set(id, transport),
    });
    transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
    await makeSession().connect(transport);
  }
  return transport.handleRequest(req, res);
}

// --- 3. HTTP mux ----------------------------------------------------------------
const http = createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (req.url && req.url.startsWith(MCP_PATH)) {
    return handleMcp(req, res).catch((e) => {
      console.error('[gateway] mcp:', e.message);
      if (!res.headersSent) { res.writeHead(500); res.end(); }
    });
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

http.listen(PORT, () => {
  console.log(`[gateway] en écoute :${PORT} · MCP ${MCP_PATH}`);
});
