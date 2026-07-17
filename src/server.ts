// server.ts
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { FoundryClient } from "./foundry-client.js";
import { createToolDefinitions, createToolHandler, withAnnotations } from "./server-tools.js";
import { createResourceHandlers } from "./server-resources.js";
import { loadSystemModules } from "./systems/index.js";

// Get the directory of this file to locate INSTRUCTIONS.md
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read instructions from INSTRUCTIONS.md
function loadInstructions(): string {
  try {
    // Look for INSTRUCTIONS.md in the project root (one level up from build/)
    const instructionsPath = path.join(__dirname, "..", "INSTRUCTIONS.md");
    return fs.readFileSync(instructionsPath, "utf-8");
  } catch (error) {
    console.error("[FoundryMCP] Warning: Could not load INSTRUCTIONS.md:", error);
    return "";
  }
}

// Create the Foundry client instance
const foundryClient = new FoundryClient();


// Load instructions for MCP clients
const instructions = loadInstructions();

// Create server instance
const server = new Server(
  {
    name: "foundry-mcp",
    version: "0.1.0",
    instructions: instructions || undefined,
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      logging: {},
    },
  }
);

// Modules système (starwarsffg…) : outils spécifiques au jeu, chargés selon
// FOUNDRY_SYSTEMS (défaut : tous les modules embarqués). Cf. systems/README.md.
const systemModules = loadSystemModules(process.env);
const systemHandlers = systemModules.map((m) => m.createHandler(foundryClient));
if (systemModules.length) {
  console.error(`[FoundryMCP] System modules: ${systemModules.map((m) => m.id).join(", ")}`);
}

// List available tools (cœur générique + modules système, tous annotés)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      ...createToolDefinitions(),
      ...systemModules.flatMap((m) => m.tools.map(withAnnotations)),
    ],
  };
});

const coreToolHandler = createToolHandler(foundryClient);
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // Les modules système répondent d'abord (test de nom bon marché),
  // le cœur générique ensuite.
  for (const handler of systemHandlers) {
    const response = await handler(request);
    if (response !== undefined) return response;
  }
  return coreToolHandler(request);
});

// Ressources MCP : documents Foundry parcourables (list paginé, read par URI).
const resources = createResourceHandlers(foundryClient);
server.setRequestHandler(ListResourcesRequestSchema, async (req) => {
  return resources.list(req.params?.cursor);
});
server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  return resources.read(req.params.uri);
});

// Notifications : chaque broadcast Foundry bufferisé part en notification de
// logging MCP (payload allégé — le détail se lit via get_events).
foundryClient.onEvent = (e) => {
  const first = e.args[0] as Record<string, unknown> | undefined;
  void server
    .sendLoggingMessage({
      level: "info",
      logger: "foundry-events",
      data: {
        seq: e.seq,
        event: e.event,
        ...(e.event === "modifyDocument" && first
          ? { type: first.type, action: first.action }
          : {}),
      },
    })
    .catch(() => {
      // transport pas encore prêt ou fermé : sans gravité
    });
};

// Start the server
async function main() {
  // Start the MCP server FIRST: tools/list must answer even if Foundry is
  // down (hosted deployments) — tool calls fail gracefully until connected.
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("FoundryVTT MCP server running on stdio");

  // Connect to FoundryVTT in the background, retrying forever.
  const tryConnect = async (): Promise<void> => {
    try {
      console.error("Connecting to FoundryVTT...");
      await foundryClient.connect();
      console.error(`Connected to FoundryVTT at ${foundryClient.getHostname()}`);
    } catch (error) {
      console.error(`FoundryVTT connection failed (retry in 30s): ${error}`);
      setTimeout(() => { void tryConnect(); }, 30000);
    }
  };
  void tryConnect();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
