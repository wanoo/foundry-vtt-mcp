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
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);
const MCP_SECRET = process.env.MCP_SECRET;
if (!MCP_SECRET) {
  console.error('MCP_SECRET est requis (env).');
  process.exit(1);
}
const MCP_PATH = `/mcp-${MCP_SECRET}`;

// --- 1. Serveur MCP stdio en child process SUPERVISÉ ---------------------------
// Si le child meurt (OOM sur un gros dump de monde, crash), on le respawn avec
// un délai — sinon la passerelle devient un zombie qui répond « Not connected ».
const credsPath = join(ROOT, 'config', 'foundry_credentials.json');
mkdirSync(dirname(credsPath), { recursive: true });
writeFileSync(credsPath, process.env.FOUNDRY_CREDENTIALS_JSON ||
  '[{"_id":"placeholder","hostname":"localhost","userid":"x","password":"x"}]');

let client = null;
const sessionServers = new Map(); // sessionId -> Server (relais des notifications)
async function connectBackend() {
  const c = new Client({ name: 'clever-gateway', version: '1.0.0' });
  await c.connect(new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, 'build', 'server.js')],
    // L'instance (nano, 512 Mo) porte DEUX process Node : le CC_NODE par défaut
    // hérité (--max-old-space-size≈268) cape aussi le child ; on lui laisse la
    // plus grosse part, c'est lui qui parse les dumps de monde.
    env: { ...process.env, FOUNDRY_CREDENTIALS: credsPath, NODE_OPTIONS: '--max-old-space-size=384' },
    stderr: 'inherit',
  }));
  // Notifications du backend (événements Foundry) → répliquées vers chaque
  // session HTTP ouverte (livrées sur leur flux SSE si le client écoute).
  c.fallbackNotificationHandler = async (notification) => {
    for (const [sid, srv] of sessionServers) {
      try {
        await srv.notification(notification);
      } catch {
        sessionServers.delete(sid);
      }
    }
  };
  c.onclose = () => {
    if (client !== c) return; // fermeture d'un ancien client déjà remplacé
    client = null;
    console.error('[gateway] backend stdio fermé — respawn dans 3 s');
    setTimeout(() => {
      connectBackend().catch((e) => {
        console.error(`[gateway] respawn raté (${e.message}) — nouvel essai dans 10 s`);
        setTimeout(() => connectBackend().catch((err) => console.error('[gateway] respawn:', err.message)), 10_000);
      });
    }, 3_000);
  };
  client = c;
  console.log('[gateway] serveur MCP stdio démarré');
}
await connectBackend();

function requireBackend() {
  if (!client) throw new Error('Backend MCP indisponible (respawn en cours) — réessayer dans quelques secondes');
  return client;
}

// --- 2. Fabrique de sessions MCP HTTP (une par client Claude) ------------------
function makeSession() {
  const server = new Server(
    { name: 'foundry-mcp-clever', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {}, logging: {} } }
  );
  // Passe-plat : outils ET ressources sont relayés au serveur stdio.
  // requireBackend() relit `client` à chaque appel : les sessions survivent au respawn.
  server.setRequestHandler(ListToolsRequestSchema, async () => requireBackend().listTools());
  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    requireBackend().callTool({ name: req.params.name, arguments: req.params.arguments || {} })
  );
  server.setRequestHandler(ListResourcesRequestSchema, async (req) =>
    requireBackend().listResources({ cursor: req.params?.cursor })
  );
  server.setRequestHandler(ReadResourceRequestSchema, async (req) =>
    requireBackend().readResource({ uri: req.params.uri })
  );
  return server;
}

const sessions = new Map(); // sessionId -> transport
async function handleMcp(req, res) {
  const sid = req.headers['mcp-session-id'];
  let transport = sid ? sessions.get(sid) : undefined;
  if (!transport) {
    if (req.method !== 'POST') { res.writeHead(400); return res.end('session inconnue'); }
    const server = makeSession();
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => { sessions.set(id, transport); sessionServers.set(id, server); },
    });
    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
        sessionServers.delete(transport.sessionId);
      }
    };
    await server.connect(transport);
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
