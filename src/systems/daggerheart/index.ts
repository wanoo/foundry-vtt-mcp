// systems/daggerheart/index.ts
// Module système Daggerheart — chemins vérifiés sur le système Foundry
// Foundryborne/daggerheart (branche main, 2026) :
//   system.traits.{agility,strength,finesse,instinct,presence,knowledge}.value
//   system.resources.{hitPoints,stress,hope}.{value,max} · system.proficiency
// Outils préfixés dh_ (convention des modules système).
import type { FoundryClient } from "../../foundry-client.js";
import type { SystemToolModule, ToolRequest, ToolResponse } from "../types.js";
import { errorResponse, successResponse } from "../../server-tools.js";
import { rollDuality, formatDuality } from "./dice.js";

const TRAITS = ["agility", "strength", "finesse", "instinct", "presence", "knowledge"];

const STAT_PATHS: Record<string, string> = {
  hit_points: "system.resources.hitPoints.value",
  stress: "system.resources.stress.value",
  hope: "system.resources.hope.value",
};

const rollDualityTool = {
  name: "dh_roll_duality",
  description:
    "Roll Daggerheart Duality Dice (2d12 Hope + Fear) with a flat modifier: doubles = critical success, Hope>Fear = with Hope, Fear>Hope = with Fear; advantage adds d6, disadvantage subtracts d6. Posts to chat.",
  inputSchema: {
    type: "object",
    properties: {
      description: { type: "string", description: `What the roll is (e.g. "Percer le mensonge du garde")` },
      modifier: { type: "number", description: "Flat modifier (trait + bonuses)" },
      difficulty: { type: "number", description: "Difficulty to beat (total >= difficulty)" },
      advantage: { type: "boolean" },
      disadvantage: { type: "boolean" },
      post: { type: "boolean", description: "Post to chat (default true)" },
      whisper_users: { type: "array", items: { type: "string" } },
    },
    required: ["description"],
  },
};

const rollActorTraitTool = {
  name: "dh_roll_actor_trait",
  description:
    `Roll Duality Dice FOR a Daggerheart actor using one of its traits (${TRAITS.join("/")}): reads system.traits.<trait>.value as the modifier, applies difficulty/advantage, posts to chat.`,
  inputSchema: {
    type: "object",
    properties: {
      actor: { type: "string", description: "Actor _id or name" },
      trait: { type: "string", enum: TRAITS },
      difficulty: { type: "number" },
      advantage: { type: "boolean" },
      disadvantage: { type: "boolean" },
      extra_modifier: { type: "number", description: "Bonus on top of the trait (experience, aid...)" },
      post: { type: "boolean", description: "Post to chat (default true)" },
      whisper_users: { type: "array", items: { type: "string" } },
    },
    required: ["actor", "trait"],
  },
};

const adjustStatsTool = {
  name: "dh_adjust_stats",
  description:
    "Adjust a Daggerheart actor's resources: hit_points (marked HP), stress, hope. DELTAS by default (hit_points: 2 = mark 2 HP); set:true for absolute. Clamped to [0, max]. Returns before/after.",
  inputSchema: {
    type: "object",
    properties: {
      actor: { type: "string", description: "Actor _id or name" },
      hit_points: { type: "number" },
      stress: { type: "number" },
      hope: { type: "number" },
      set: { type: "boolean", description: "true = absolute values (default false = deltas)" },
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
  const findActor = async (arg: string) =>
    (await foundryClient.getDocument("actors", { _id: arg, name: arg }, {}))
      ?? (await foundryClient.getDocument("actors", { name: arg }, {}));

  const postRoll = async (
    title: string,
    summary: string,
    flags: Record<string, unknown>,
    whisper: string[]
  ) => {
    const message: Record<string, unknown> = {
      content: `<h3>🎲 ${title}</h3><p><strong>${summary}</strong></p>`,
      author: foundryClient.getUserId(),
      flags: { "foundry-mcp": flags },
    };
    if (whisper.length) message.whisper = whisper;
    await foundryClient.createDocument("ChatMessage", [message]);
  };

  return async (request: ToolRequest): Promise<ToolResponse | undefined> => {
    const { name, arguments: args } = request.params;

    if (name === "dh_roll_duality" || name === "dh_roll_actor_trait") {
      try {
        let modifier: number;
        let title: string;
        let actorRef: Record<string, unknown> | null = null;

        if (name === "dh_roll_duality") {
          const description = args?.description as string | undefined;
          if (!description) return errorResponse("Error: 'description' is required");
          modifier = (args?.modifier as number | undefined) ?? 0;
          title = description;
        } else {
          const actorArg = args?.actor as string | undefined;
          const trait = (args?.trait as string | undefined)?.toLowerCase();
          if (!actorArg || !trait) return errorResponse("Error: 'actor' and 'trait' are required");
          if (!TRAITS.includes(trait)) {
            return errorResponse(`Error: Unknown trait '${trait}'. Valid: ${TRAITS.join(", ")}`);
          }
          const actor = await findActor(actorArg);
          if (!actor) return errorResponse(`Error: Actor not found: ${actorArg}`);
          actorRef = actor;
          const traitValue = Number(getPath(actor, `system.traits.${trait}.value`)) || 0;
          modifier = traitValue + ((args?.extra_modifier as number | undefined) ?? 0);
          title = `${actor.name} — ${trait.charAt(0).toUpperCase() + trait.slice(1)} (${traitValue >= 0 ? "+" : ""}${traitValue})`;
        }

        const result = rollDuality({
          modifier,
          difficulty: (args?.difficulty as number | undefined) ?? null,
          advantage: args?.advantage as boolean | undefined,
          disadvantage: args?.disadvantage as boolean | undefined,
        });
        const summary = formatDuality(result);

        let posted = false;
        if ((args?.post as boolean | undefined) ?? true) {
          await postRoll(
            title + (args?.difficulty ? ` (Difficulté ${args.difficulty})` : ""),
            summary,
            { duality: { actor: actorRef?._id ?? null, result } },
            (args?.whisper_users as string[] | undefined) ?? []
          );
          posted = true;
        }
        return successResponse({
          ...(actorRef ? { actor: { _id: actorRef._id, name: actorRef.name } } : {}),
          ...result,
          summary,
          posted,
        });
      } catch (error) {
        return errorResponse(
          `Error rolling duality dice: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "dh_adjust_stats") {
      try {
        const actorArg = args?.actor as string | undefined;
        if (!actorArg) return errorResponse("Error: 'actor' is required");
        const requested = Object.keys(STAT_PATHS).filter((k) => args?.[k] !== undefined);
        if (!requested.length) {
          return errorResponse(`Error: provide at least one of: ${Object.keys(STAT_PATHS).join(", ")}`);
        }
        const actor = await findActor(actorArg);
        if (!actor) return errorResponse(`Error: Actor not found: ${actorArg}`);

        const absolute = (args?.set as boolean | undefined) ?? false;
        const update: Record<string, unknown> = {};
        const changes: Record<string, { before: number; after: number }> = {};
        for (const key of requested) {
          const path = STAT_PATHS[key];
          const before = Number(getPath(actor, path)) || 0;
          const max = Number(getPath(actor, path.replace(/\.value$/, ".max")));
          const input = args?.[key] as number;
          let after = Math.max(0, absolute ? input : before + input);
          if (Number.isFinite(max) && max > 0) after = Math.min(after, max);
          update[path] = after;
          changes[key] = { before, after };
        }
        const result = await foundryClient.modifyDocument("Actor", actor._id as string, [update]);
        return successResponse({ actor: { _id: actor._id, name: actor.name }, mode: absolute ? "set" : "delta", changes, result });
      } catch (error) {
        return errorResponse(
          `Error adjusting daggerheart stats: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return undefined;
  };
}

export const daggerheartModule: SystemToolModule = {
  id: "daggerheart",
  label: "Daggerheart (Darrington Press)",
  tools: [rollDualityTool, rollActorTraitTool, adjustStatsTool],
  createHandler,
};
