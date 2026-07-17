// systems/starwarsffg/index.ts
// Module système Star Wars FFG (Edge of the Empire / Age of Rebellion /
// Force and Destiny) — outils spécifiques au système starwarsffg.
import type { FoundryClient } from "../../foundry-client.js";
import type { SystemToolModule, ToolRequest, ToolResponse } from "../types.js";
import { errorResponse, successResponse } from "../../server-tools.js";
import { rollFfgPool, formatPool, formatResult, type FfgPool } from "./dice.js";

const requestPlayerRollTool = {
  name: "request_player_roll",
  description:
    "Post a Star Wars FFG roll request in chat: a message with a '🎲' button that opens the FFG dice-pool dialog pre-filled for the player who clicks it (system flag ffg-pool-to-player). starwarsffg only.",
  inputSchema: {
    type: "object",
    properties: {
      description: { type: "string", description: `Short label of the check (e.g. "Test de Peur", "Perception moyenne")` },
      content: {
        type: "string",
        description: "Optional HTML shown above the button (context, stakes, spending guide). The button is appended automatically.",
      },
      difficulty: { type: "number", description: "Difficulty dice [di] (default 0)" },
      challenge: { type: "number", description: "Challenge dice [ch] (default 0)" },
      ability: { type: "number", description: "Ability dice [ab] added to the player's pool (default 0)" },
      proficiency: { type: "number", description: "Proficiency dice [pr] (default 0)" },
      boost: { type: "number", description: "Boost dice [bo] (default 0)" },
      setback: { type: "number", description: "Setback dice [se] (default 0)" },
      force: { type: "number", description: "Force dice [fo] (default 0)" },
      skill_name: { type: "string", description: "Skill name displayed in the roll dialog (default: the description)" },
      whisper_users: {
        type: "array",
        items: { type: "string" },
        description: "Optional user _ids to whisper the request to (default: public message)",
      },
    },
    required: ["description"],
  },
};

const rollFfgPoolTool = {
  name: "roll_ffg_pool",
  description:
    "Roll a Star Wars FFG narrative dice pool SERVER-SIDE (official die faces) and post the result to chat. Autonomous — no GM browser needed. For a roll made BY a player, prefer request_player_roll.",
  inputSchema: {
    type: "object",
    properties: {
      description: { type: "string", description: `What the roll is (e.g. "Perception d'Uchebe")` },
      ability: { type: "number" }, proficiency: { type: "number" },
      difficulty: { type: "number" }, challenge: { type: "number" },
      boost: { type: "number" }, setback: { type: "number" }, force: { type: "number" },
      post: { type: "boolean", description: "Post the result to chat (default true)" },
      whisper_users: { type: "array", items: { type: "string" }, description: "Whisper the chat message to these user _ids" },
    },
    required: ["description"],
  },
};

// Chemins vérifiés sur le système starwarsffg 2.0.3 (fiche PJ réelle) :
// system.stats.{wounds,strain}.value · system.stats.credits.value ·
// system.experience.{total,available}. Les max/soak sont DÉRIVÉS (ne pas écrire).
const STAT_PATHS: Record<string, string> = {
  wounds: "system.stats.wounds.value",
  strain: "system.stats.strain.value",
  credits: "system.stats.credits.value",
  xp_available: "system.experience.available",
  xp_total: "system.experience.total",
};

const adjustActorStatsTool = {
  name: "adjust_actor_stats",
  description:
    "Adjust a starwarsffg actor's live stats without knowing the system paths: wounds, strain, credits, xp_available, xp_total. Values are DELTAS by default (wounds: 2 = +2 wounds; credits: -50 = spend 50); use set:true for absolute values. Returns before/after.",
  inputSchema: {
    type: "object",
    properties: {
      actor: { type: "string", description: "Actor _id or name" },
      wounds: { type: "number", description: "Wounds taken (delta or absolute)" },
      strain: { type: "number", description: "Strain taken (delta or absolute)" },
      credits: { type: "number", description: "Credits (delta or absolute)" },
      xp_available: { type: "number", description: "Available XP (delta or absolute)" },
      xp_total: { type: "number", description: "Total XP (delta or absolute)" },
      set: { type: "boolean", description: "true = absolute values instead of deltas (default false)" },
    },
    required: ["actor"],
  },
};

function getPath(doc: Record<string, unknown>, path: string): unknown {
  let cur: unknown = doc;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function createHandler(foundryClient: FoundryClient) {
  return async (request: ToolRequest): Promise<ToolResponse | undefined> => {
    const { name, arguments: args } = request.params;

    if (name === "request_player_roll") {
      try {
        const description = args?.description as string | undefined;
        if (!description) {
          return errorResponse("Error: 'description' is required");
        }
        const pool: Record<string, number> = {};
        for (const die of ["difficulty", "challenge", "ability", "proficiency", "boost", "setback", "force"]) {
          const n = args?.[die] as number | undefined;
          if (n) pool[die] = n;
        }
        const body = (args?.content as string | undefined) ?? `<h3>🎲 ${description}</h3>`;
        const whisper = (args?.whisper_users as string[] | undefined) ?? [];

        // Format vérifié dans le système starwarsffg (bouton .ffg-pool-to-player) :
        // le clic ouvre le dialogue de jet FFG pré-rempli avec dicePool.
        const message: Record<string, unknown> = {
          content: `${body}\n<button class="ffg-pool-to-player">🎲 Lancer — ${description}</button>`,
          author: foundryClient.getUserId(),
          flags: {
            starwarsffg: {
              dicePool: pool,
              description,
              roll: {
                data: {},
                skillName: (args?.skill_name as string | undefined) ?? description,
                item: {},
                flavor: "",
                sound: null,
              },
            },
          },
        };
        if (whisper.length) message.whisper = whisper;

        const result = await foundryClient.createDocument("ChatMessage", [message]);
        return successResponse({ posted: description, pool, whisper: whisper.length ? whisper : "public", result });
      } catch (error) {
        return errorResponse(
          `Error posting roll request: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "roll_ffg_pool") {
      try {
        const description = args?.description as string | undefined;
        if (!description) return errorResponse("Error: 'description' is required");
        const pool: FfgPool = {};
        for (const die of ["ability", "proficiency", "difficulty", "challenge", "boost", "setback", "force"] as const) {
          const n = args?.[die] as number | undefined;
          if (n) pool[die] = n;
        }
        const roll = rollFfgPool(pool);
        const summary = formatResult(roll);

        let posted = false;
        if ((args?.post as boolean | undefined) ?? true) {
          const whisper = (args?.whisper_users as string[] | undefined) ?? [];
          const facesHtml = Object.entries(roll.faces)
            .map(([die, faces]) => `<em>${die}</em> : ${faces.join(", ")}`)
            .join("<br>");
          const message: Record<string, unknown> = {
            content: `<h3>🎲 ${description}</h3><p>${formatPool(pool)}</p><p><strong>${summary}</strong></p><p style="font-size:.85em">${facesHtml}</p>`,
            author: foundryClient.getUserId(),
            flags: { "foundry-mcp": { roll: { pool, result: roll } } },
          };
          if (whisper.length) message.whisper = whisper;
          await foundryClient.createDocument("ChatMessage", [message]);
          posted = true;
        }
        return successResponse({ description, pool: formatPool(pool), summary, detail: roll, posted });
      } catch (error) {
        return errorResponse(
          `Error rolling FFG pool: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "adjust_actor_stats") {
      try {
        const actorArg = args?.actor as string | undefined;
        if (!actorArg) return errorResponse("Error: 'actor' is required");
        const requested = Object.keys(STAT_PATHS).filter((k) => args?.[k] !== undefined);
        if (!requested.length) {
          return errorResponse(`Error: provide at least one of: ${Object.keys(STAT_PATHS).join(", ")}`);
        }
        const actor = await foundryClient.getDocument(
          "actors",
          { _id: actorArg, name: actorArg },
          { requestedFields: ["_id", "name", "system"] }
        ) ?? await foundryClient.getDocument("actors", { name: actorArg }, { requestedFields: ["_id", "name", "system"] });
        if (!actor) return errorResponse(`Error: Actor not found: ${actorArg}`);

        const absolute = (args?.set as boolean | undefined) ?? false;
        const update: Record<string, unknown> = {};
        const changes: Record<string, { before: number; after: number }> = {};
        for (const key of requested) {
          const path = STAT_PATHS[key];
          const before = (getPath(actor, path) as number | undefined) ?? 0;
          const input = args?.[key] as number;
          const after = Math.max(0, absolute ? input : before + input);
          update[path] = after;
          changes[key] = { before, after };
        }
        const result = await foundryClient.modifyDocument("Actor", actor._id as string, [update]);
        return successResponse({ actor: { _id: actor._id, name: actor.name }, mode: absolute ? "set" : "delta", changes, result });
      } catch (error) {
        return errorResponse(
          `Error adjusting actor stats: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return undefined; // outil inconnu de ce module
  };
}

export const starwarsffgModule: SystemToolModule = {
  id: "starwarsffg",
  label: "Star Wars FFG (EotE / AoR / FaD)",
  tools: [requestPlayerRollTool, rollFfgPoolTool, adjustActorStatsTool],
  createHandler,
};
