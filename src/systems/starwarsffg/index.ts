// systems/starwarsffg/index.ts
// Module système Star Wars FFG (Edge of the Empire / Age of Rebellion /
// Force and Destiny) — outils spécifiques au système starwarsffg.
import type { FoundryClient } from "../../foundry-client.js";
import type { SystemToolModule, ToolRequest, ToolResponse } from "../types.js";
import { errorResponse, successResponse } from "../../server-tools.js";
import { rollFfgPool, formatPool, formatResult, type FfgPool } from "./dice.js";
import { deriveSkillPool } from "./derived.js";

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

// Chemins vérifiés sur le système starwarsffg 2.0.3 (fiches réelles) :
// personnages system.stats.{wounds,strain,credits}.value + experience +
// obligation/duty/morality/conflict ; véhicules system.stats.{hullTrauma,
// systemStrain}.value. Les max/soak sont DÉRIVÉS (ne pas écrire).
const STAT_PATHS: Record<string, string> = {
  wounds: "system.stats.wounds.value",
  strain: "system.stats.strain.value",
  credits: "system.stats.credits.value",
  xp_available: "system.experience.available",
  xp_total: "system.experience.total",
  obligation: "system.obligation.value",
  duty: "system.duty.value",
  morality: "system.morality.value",
  conflict: "system.conflict.value",
  hull_trauma: "system.stats.hullTrauma.value",
  system_strain: "system.stats.systemStrain.value",
};

const adjustActorStatsTool = {
  name: "adjust_actor_stats",
  description:
    "Adjust a starwarsffg actor's live stats without knowing the system paths: wounds, strain, credits, xp_available, xp_total, obligation, duty, morality, conflict — and for vehicles hull_trauma, system_strain. Values are DELTAS by default (wounds: 2 = +2 wounds; credits: -50 = spend 50); use set:true for absolute values. Returns before/after.",
  inputSchema: {
    type: "object",
    properties: {
      actor: { type: "string", description: "Actor _id or name" },
      wounds: { type: "number", description: "Wounds taken (delta or absolute)" },
      strain: { type: "number", description: "Strain taken (delta or absolute)" },
      credits: { type: "number", description: "Credits (delta or absolute)" },
      xp_available: { type: "number", description: "Available XP (delta or absolute)" },
      xp_total: { type: "number", description: "Total XP (delta or absolute)" },
      obligation: { type: "number", description: "Obligation (delta or absolute)" },
      duty: { type: "number", description: "Duty (delta or absolute)" },
      morality: { type: "number", description: "Morality (delta or absolute)" },
      conflict: { type: "number", description: "Conflict (delta or absolute)" },
      hull_trauma: { type: "number", description: "Vehicles: hull trauma (delta or absolute)" },
      system_strain: { type: "number", description: "Vehicles: system strain (delta or absolute)" },
      set: { type: "boolean", description: "true = absolute values instead of deltas (default false)" },
    },
    required: ["actor"],
  },
};

const rollActorSkillTool = {
  name: "roll_actor_skill",
  description:
    "Roll a skill check FOR an actor: derives the real dice pool from the sheet (stored values + species/equipment/learned-talent modifiers — the displayed-vs-source trap is handled), builds yellows/greens + talent boosts, adds your difficulty, rolls server-side and posts to chat with the derivation detail.",
  inputSchema: {
    type: "object",
    properties: {
      actor: { type: "string", description: "Actor _id or name" },
      skill: { type: "string", description: `Skill name as on the sheet (e.g. "Perception", "Vigilance", "Melee") — case-insensitive` },
      difficulty: { type: "number", description: "Difficulty dice [di] (default 0)" },
      challenge: { type: "number", description: "Challenge dice [ch] (default 0)" },
      boost: { type: "number", description: "Extra boost dice on top of talent boosts" },
      setback: { type: "number", description: "Setback dice (talent Remove Setback is applied automatically)" },
      force: { type: "number", description: "Force dice (default 0)" },
      post: { type: "boolean", description: "Post the result to chat (default true)" },
      whisper_users: { type: "array", items: { type: "string" }, description: "Whisper to these user _ids" },
    },
    required: ["actor", "skill"],
  },
};

// Points de Destinée : settings world starwarsffg.dPoolLight / dPoolDark
// (mêmes clés que les macros MJ et le système).
const adjustDestinyTool = {
  name: "adjust_destiny",
  description:
    "Read or change the Destiny Pool (starwarsffg.dPoolLight/dPoolDark settings): action read, spend_light / spend_dark (converts the point to the other side, as per the rules), or set with explicit light/dark values.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["read", "spend_light", "spend_dark", "set"] },
      light: { type: "number", description: "set: light-side points" },
      dark: { type: "number", description: "set: dark-side points" },
    },
    required: ["action"],
  },
};

const grantXpTool = {
  name: "grant_xp",
  description:
    "Grant XP to several actors at once (end of session): adds the amount to BOTH experience.available and experience.total. Default targets: every 'character'-type actor (the PCs).",
  inputSchema: {
    type: "object",
    properties: {
      amount: { type: "number", description: "XP to grant to each actor" },
      actors: {
        type: "array",
        items: { type: "string" },
        description: "Actor _ids or names (default: all character-type actors)",
      },
    },
    required: ["amount"],
  },
};

const applyCriticalInjuryTool = {
  name: "apply_critical_injury",
  description:
    "Apply a critical injury by the book: counts the actor's existing criticalinjury items (+10 to the d100 roll each), draws from the critical-injury RollTable, resolves the linked compendium item and embeds it on the actor. Posts the result to chat.",
  inputSchema: {
    type: "object",
    properties: {
      actor: { type: "string", description: "Actor _id or name" },
      table: { type: "string", description: `RollTable _id or name (default: first table whose name matches "critique"/"critical" + "blessure"/"injur")` },
      extra_modifier: { type: "number", description: "Additional modifier on top of the automatic +10/existing injury (e.g. weapon Vicious)" },
      roll_only: { type: "boolean", description: "true = draw and report without attaching the injury item (default false)" },
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

    if (name === "roll_actor_skill") {
      try {
        const actorArg = args?.actor as string | undefined;
        const skillArg = args?.skill as string | undefined;
        if (!actorArg || !skillArg) return errorResponse("Error: 'actor' and 'skill' are required");
        const actor = await foundryClient.getDocument("actors", { _id: actorArg, name: actorArg }, {})
          ?? await foundryClient.getDocument("actors", { name: actorArg }, {});
        if (!actor) return errorResponse(`Error: Actor not found: ${actorArg}`);

        const derived = deriveSkillPool(actor as Record<string, unknown>, skillArg);
        if (!derived) {
          return errorResponse(`Error: Skill '${skillArg}' not found on ${actor.name}`);
        }

        const setback = Math.max(
          0,
          ((args?.setback as number | undefined) ?? 0) + derived.setback - derived.removeSetback
        );
        const pool: FfgPool = {
          ability: derived.ability,
          proficiency: derived.proficiency,
          boost: derived.boost + ((args?.boost as number | undefined) ?? 0),
          setback,
          difficulty: (args?.difficulty as number | undefined) ?? 0,
          challenge: (args?.challenge as number | undefined) ?? 0,
          force: (args?.force as number | undefined) ?? 0,
        };
        for (const k of Object.keys(pool) as (keyof FfgPool)[]) {
          if (!pool[k]) delete pool[k];
        }
        const roll = rollFfgPool(pool);
        const summary = formatResult(roll);
        const derivation =
          `${derived.characteristic} ${derived.characteristicValue} + rang ${derived.rank}` +
          (derived.sources.length ? ` · mods : ${derived.sources.join(", ")}` : "");

        let posted = false;
        if ((args?.post as boolean | undefined) ?? true) {
          const whisper = (args?.whisper_users as string[] | undefined) ?? [];
          const message: Record<string, unknown> = {
            content:
              `<h3>🎲 ${actor.name} — ${derived.skill}</h3><p>${formatPool(pool)}</p>` +
              `<p><strong>${summary}</strong></p><p style="font-size:.85em">${derivation}</p>`,
            author: foundryClient.getUserId(),
            flags: { "foundry-mcp": { skillRoll: { actor: actor._id, skill: derived.skill, pool, result: roll } } },
          };
          if (whisper.length) message.whisper = whisper;
          await foundryClient.createDocument("ChatMessage", [message]);
          posted = true;
        }
        return successResponse({
          actor: { _id: actor._id, name: actor.name },
          skill: derived.skill,
          derivation: { ...derived },
          pool: formatPool(pool),
          summary,
          detail: roll,
          posted,
        });
      } catch (error) {
        return errorResponse(
          `Error rolling actor skill: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "adjust_destiny") {
      try {
        const action = args?.action as string | undefined;
        if (!action) return errorResponse("Error: 'action' is required");
        const KEYS = { light: "starwarsffg.dPoolLight", dark: "starwarsffg.dPoolDark" };

        const readPool = async () => {
          const docs = (await foundryClient.getSettings({
            where: { key__in: Object.values(KEYS) },
          })) as Record<string, unknown>[];
          const val = (key: string) => {
            const doc = docs.find((d) => d.key === key);
            const raw = doc?.value;
            const parsed = typeof raw === "string" ? Number(JSON.parse(raw || "0")) : Number(raw);
            return { _id: doc?._id as string | undefined, value: Number.isFinite(parsed) ? parsed : 0 };
          };
          return { light: val(KEYS.light), dark: val(KEYS.dark) };
        };
        const writeSide = async (key: string, existing: { _id?: string }, value: number) => {
          if (existing._id) {
            await foundryClient.modifyDocument("Setting", existing._id, [{ value: JSON.stringify(value) }]);
          } else {
            await foundryClient.createDocument("Setting", [{ key, value: JSON.stringify(value) }]);
          }
        };

        const pool = await readPool();
        if (action === "read") {
          return successResponse({ light: pool.light.value, dark: pool.dark.value });
        }
        let light = pool.light.value;
        let dark = pool.dark.value;
        if (action === "spend_light" || action === "spend_dark") {
          // Règle FFG : un point dépensé bascule de l'autre côté.
          if (action === "spend_light") {
            if (light <= 0) return errorResponse("Error: no light-side destiny point to spend");
            light -= 1; dark += 1;
          } else {
            if (dark <= 0) return errorResponse("Error: no dark-side destiny point to spend");
            dark -= 1; light += 1;
          }
        } else if (action === "set") {
          if (args?.light === undefined && args?.dark === undefined) {
            return errorResponse("Error: set requires light and/or dark");
          }
          if (args?.light !== undefined) light = Math.max(0, args.light as number);
          if (args?.dark !== undefined) dark = Math.max(0, args.dark as number);
        } else {
          return errorResponse(`Error: Unknown action '${action}'`);
        }
        if (light !== pool.light.value) await writeSide(KEYS.light, pool.light, light);
        if (dark !== pool.dark.value) await writeSide(KEYS.dark, pool.dark, dark);
        return successResponse({ action, light, dark, before: { light: pool.light.value, dark: pool.dark.value } });
      } catch (error) {
        return errorResponse(
          `Error adjusting destiny pool: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "grant_xp") {
      try {
        const amount = args?.amount as number | undefined;
        if (!amount) return errorResponse("Error: 'amount' is required");
        const wanted = args?.actors as string[] | undefined;
        let targets: Record<string, unknown>[];
        if (wanted?.length) {
          targets = [];
          for (const w of wanted) {
            const a = await foundryClient.getDocument("actors", { _id: w, name: w }, { requestedFields: ["_id", "name", "system"] })
              ?? await foundryClient.getDocument("actors", { name: w }, { requestedFields: ["_id", "name", "system"] });
            if (!a) return errorResponse(`Error: Actor not found: ${w}`);
            targets.push(a);
          }
        } else {
          targets = (await foundryClient.getDocuments("actors", {
            where: { type: "character" },
            requestedFields: ["_id", "name", "system"],
          })) as Record<string, unknown>[];
        }
        if (!targets.length) return errorResponse("Error: no target actors");

        const granted: Array<Record<string, unknown>> = [];
        for (const actor of targets) {
          const xp = ((actor.system as Record<string, unknown>)?.experience as Record<string, unknown>) ?? {};
          const available = (Number(xp.available) || 0) + amount;
          const total = (Number(xp.total) || 0) + amount;
          await foundryClient.modifyDocument("Actor", actor._id as string, [
            { "system.experience.available": available, "system.experience.total": total },
          ]);
          granted.push({ _id: actor._id, name: actor.name, available, total });
        }
        return successResponse({ amount, granted });
      } catch (error) {
        return errorResponse(
          `Error granting XP: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "apply_critical_injury") {
      try {
        const actorArg = args?.actor as string | undefined;
        if (!actorArg) return errorResponse("Error: 'actor' is required");
        const actor = await foundryClient.getDocument("actors", { _id: actorArg, name: actorArg }, { requestedFields: ["_id", "name", "items"] })
          ?? await foundryClient.getDocument("actors", { name: actorArg }, { requestedFields: ["_id", "name", "items"] });
        if (!actor) return errorResponse(`Error: Actor not found: ${actorArg}`);

        const existing = ((actor.items as Record<string, unknown>[] | undefined) ?? [])
          .filter((i) => i.type === "criticalinjury");
        const modifier = existing.length * 10 + ((args?.extra_modifier as number | undefined) ?? 0);

        // Table : fournie, sinon détection par nom (critique/critical + blessure/injur).
        let table: Record<string, unknown> | null = null;
        const tableArg = args?.table as string | undefined;
        if (tableArg) {
          table = await foundryClient.getDocument("tables", { _id: tableArg, name: tableArg }, {})
            ?? await foundryClient.getDocument("tables", { name: tableArg }, {});
        } else {
          const tables = (await foundryClient.getDocuments("tables", {})) as Record<string, unknown>[];
          table = tables.find((t) => {
            const n = String(t.name ?? "").toLowerCase();
            return /crit/.test(n) && /blessure|injur/.test(n);
          }) ?? null;
        }
        if (!table) return errorResponse("Error: critical-injury RollTable not found (pass 'table')");

        // Tirage (formule NdM±k + modificateur).
        const formula = ((table.formula as string) || "1d100").replace(/\s+/g, "");
        const match = formula.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
        if (!match) return errorResponse(`Error: Unsupported table formula '${formula}'`);
        let roll = parseInt(match[3] ?? "0", 10) + modifier;
        for (let d = 0; d < parseInt(match[1], 10); d++) {
          roll += 1 + Math.floor(Math.random() * parseInt(match[2], 10));
        }
        const results = (table.results as Record<string, unknown>[] | undefined) ?? [];
        const hit = results.find((r) => {
          const range = r.range as [number, number] | undefined;
          return range && roll >= range[0] && roll <= range[1];
        });
        const text = (hit?.description as string) ?? (hit?.text as string) ?? (hit?.name as string) ?? null;

        // Résoudre l'item de blessure lié (@UUID[Compendium.<pack>.<id>]) et l'attacher.
        let attached: Record<string, unknown> | null = null;
        if (!(args?.roll_only as boolean | undefined) && text) {
          const uuidMatch = text.match(/@UUID\[Compendium\.([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\.(?:Item\.)?([A-Za-z0-9]+)\]/);
          if (uuidMatch) {
            const [, pack, itemId] = uuidMatch;
            const docs = await foundryClient.getPackDocuments("Item", pack, { query: { _id: itemId } });
            if (docs.length) {
              const injury = { ...docs[0] } as Record<string, unknown>;
              delete injury.folder;
              await foundryClient.createDocument("Item", [injury], { parentUuid: `Actor.${actor._id}` });
              attached = { name: injury.name };
            }
          }
        }

        await foundryClient.createDocument("ChatMessage", [{
          content:
            `<h3>🩸 Blessure critique — ${actor.name}</h3>` +
            `<p>Tirage : <strong>${roll}</strong>${modifier ? ` (dont +${modifier} : ${existing.length} blessure(s) existante(s)${args?.extra_modifier ? " + modificateur" : ""})` : ""}</p>` +
            `<blockquote>${text ?? "<em>hors table</em>"}</blockquote>`,
          author: foundryClient.getUserId(),
          flags: { "foundry-mcp": { criticalInjury: { actor: actor._id, roll, modifier } } },
        }]);

        return successResponse({
          actor: { _id: actor._id, name: actor.name },
          roll,
          modifier,
          existing_injuries: existing.length,
          result: text,
          attached,
        });
      } catch (error) {
        return errorResponse(
          `Error applying critical injury: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return undefined; // outil inconnu de ce module
  };
}

export const starwarsffgModule: SystemToolModule = {
  id: "starwarsffg",
  label: "Star Wars FFG (EotE / AoR / FaD)",
  tools: [
    requestPlayerRollTool,
    rollFfgPoolTool,
    adjustActorStatsTool,
    rollActorSkillTool,
    adjustDestinyTool,
    grantXpTool,
    applyCriticalInjuryTool,
  ],
  createHandler,
};
