// systems/dnd5e/index.ts
// Module système D&D 5e — chemins du système dnd5e (stables depuis des années) :
// system.abilities.<ab>.{value,proficient} · system.skills.<sk>.{value,ability}
// system.attributes.hp.{value,max,temp} · system.attributes.exhaustion ·
// system.details.{level,xp.value,cr} · system.currency.{pp,gp,ep,sp,cp}.
// Outils préfixés dnd5e_ (convention des modules système).
import type { FoundryClient } from "../../foundry-client.js";
import type { SystemToolModule, ToolRequest, ToolResponse } from "../types.js";
import { errorResponse, successResponse } from "../../server-tools.js";
import { rollD20, abilityModifier, proficiencyBonus, formatD20 } from "./dice.js";

const ABILITIES: Record<string, string> = {
  str: "Strength", dex: "Dexterity", con: "Constitution",
  int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};
const SKILLS: Record<string, { ability: string; label: string }> = {
  acr: { ability: "dex", label: "Acrobatics" }, ani: { ability: "wis", label: "Animal Handling" },
  arc: { ability: "int", label: "Arcana" }, ath: { ability: "str", label: "Athletics" },
  dec: { ability: "cha", label: "Deception" }, his: { ability: "int", label: "History" },
  ins: { ability: "wis", label: "Insight" }, itm: { ability: "cha", label: "Intimidation" },
  inv: { ability: "int", label: "Investigation" }, med: { ability: "wis", label: "Medicine" },
  nat: { ability: "int", label: "Nature" }, prc: { ability: "wis", label: "Perception" },
  prf: { ability: "cha", label: "Performance" }, per: { ability: "cha", label: "Persuasion" },
  rel: { ability: "int", label: "Religion" }, slt: { ability: "dex", label: "Sleight of Hand" },
  ste: { ability: "dex", label: "Stealth" }, sur: { ability: "wis", label: "Survival" },
};
const SKILL_BY_LABEL = Object.fromEntries(
  Object.entries(SKILLS).map(([k, v]) => [v.label.toLowerCase(), k])
);

const STAT_PATHS: Record<string, string> = {
  hp: "system.attributes.hp.value",
  temp_hp: "system.attributes.hp.temp",
  xp: "system.details.xp.value",
  exhaustion: "system.attributes.exhaustion",
  pp: "system.currency.pp", gp: "system.currency.gp", ep: "system.currency.ep",
  sp: "system.currency.sp", cp: "system.currency.cp",
};

const rollCheckTool = {
  name: "dnd5e_roll_check",
  description:
    `Roll a d20 check FOR a dnd5e actor: ability check ("str"), skill ("athletics" or "ath"), or saving throw ("dex_save"). Derives the modifier from the sheet (ability mod + proficiency), applies advantage/disadvantage (they cancel), compares to DC, posts to chat.`,
  inputSchema: {
    type: "object",
    properties: {
      actor: { type: "string", description: "Actor _id or name" },
      check: { type: "string", description: `"str"…"cha" (ability), a skill name/abbrev, or "<ability>_save"` },
      dc: { type: "number", description: "Difficulty Class to compare against" },
      advantage: { type: "boolean" },
      disadvantage: { type: "boolean" },
      post: { type: "boolean", description: "Post to chat (default true)" },
      whisper_users: { type: "array", items: { type: "string" } },
    },
    required: ["actor", "check"],
  },
};

const adjustStatsTool = {
  name: "dnd5e_adjust_stats",
  description:
    "Adjust a dnd5e actor's stats without knowing the paths: hp, temp_hp, xp, exhaustion, and currency (pp/gp/ep/sp/cp). DELTAS by default (hp: -7 = take 7 damage); set:true for absolute. HP is clamped to [0, max]. Returns before/after.",
  inputSchema: {
    type: "object",
    properties: {
      actor: { type: "string", description: "Actor _id or name" },
      hp: { type: "number" }, temp_hp: { type: "number" },
      xp: { type: "number" }, exhaustion: { type: "number" },
      pp: { type: "number" }, gp: { type: "number" }, ep: { type: "number" },
      sp: { type: "number" }, cp: { type: "number" },
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

  return async (request: ToolRequest): Promise<ToolResponse | undefined> => {
    const { name, arguments: args } = request.params;

    if (name === "dnd5e_roll_check") {
      try {
        const actorArg = args?.actor as string | undefined;
        const checkArg = (args?.check as string | undefined)?.toLowerCase().trim();
        if (!actorArg || !checkArg) return errorResponse("Error: 'actor' and 'check' are required");
        const actor = await findActor(actorArg);
        if (!actor) return errorResponse(`Error: Actor not found: ${actorArg}`);
        const system = (actor.system as Record<string, unknown>) ?? {};

        const level = Number(getPath(system, "details.level"))
          || Number(getPath(system, "details.cr")) || 1;
        const prof = proficiencyBonus(level);
        const abilityScore = (ab: string) =>
          Number(getPath(system, `abilities.${ab}.value`)) || 10;

        let label: string;
        let modifier: number;
        const saveMatch = checkArg.match(/^([a-z]{3})[_ -]?save$/);
        if (saveMatch && ABILITIES[saveMatch[1]]) {
          const ab = saveMatch[1];
          const proficient = Number(getPath(system, `abilities.${ab}.proficient`)) || 0;
          modifier = abilityModifier(abilityScore(ab)) + Math.floor(proficient * prof);
          label = `Sauvegarde de ${ABILITIES[ab]}`;
        } else if (ABILITIES[checkArg]) {
          modifier = abilityModifier(abilityScore(checkArg));
          label = `Test de ${ABILITIES[checkArg]}`;
        } else {
          const key = SKILLS[checkArg] ? checkArg : SKILL_BY_LABEL[checkArg];
          if (!key) {
            return errorResponse(
              `Error: Unknown check '${args?.check}'. Abilities: ${Object.keys(ABILITIES).join("/")} (+_save) · skills: ${Object.values(SKILLS).map((s) => s.label).join(", ")}`
            );
          }
          const skill = SKILLS[key];
          const ability = String(getPath(system, `skills.${key}.ability`) ?? skill.ability);
          const mult = Number(getPath(system, `skills.${key}.value`)) || 0;
          modifier = abilityModifier(abilityScore(ability)) + Math.floor(mult * prof);
          label = skill.label;
        }

        const result = rollD20({
          modifier,
          advantage: args?.advantage as boolean | undefined,
          disadvantage: args?.disadvantage as boolean | undefined,
          dc: (args?.dc as number | undefined) ?? null,
        });
        const summary = formatD20(result);

        let posted = false;
        if ((args?.post as boolean | undefined) ?? true) {
          const whisper = (args?.whisper_users as string[] | undefined) ?? [];
          const message: Record<string, unknown> = {
            content: `<h3>🎲 ${actor.name} — ${label}${args?.dc ? ` (DD ${args.dc})` : ""}</h3><p><strong>${summary}</strong></p>`,
            author: foundryClient.getUserId(),
            flags: { "foundry-mcp": { d20: { actor: actor._id, check: checkArg, result } } },
          };
          if (whisper.length) message.whisper = whisper;
          await foundryClient.createDocument("ChatMessage", [message]);
          posted = true;
        }
        return successResponse({ actor: { _id: actor._id, name: actor.name }, check: label, ...result, summary, posted });
      } catch (error) {
        return errorResponse(
          `Error rolling dnd5e check: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "dnd5e_adjust_stats") {
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
        const hpMax = Number(getPath(actor, "system.attributes.hp.max")) || Infinity;
        const update: Record<string, unknown> = {};
        const changes: Record<string, { before: number; after: number }> = {};
        for (const key of requested) {
          const path = STAT_PATHS[key];
          const before = Number(getPath(actor, path)) || 0;
          const input = args?.[key] as number;
          let after = Math.max(0, absolute ? input : before + input);
          if (key === "hp") after = Math.min(after, hpMax);
          update[path] = after;
          changes[key] = { before, after };
        }
        const result = await foundryClient.modifyDocument("Actor", actor._id as string, [update]);
        return successResponse({ actor: { _id: actor._id, name: actor.name }, mode: absolute ? "set" : "delta", changes, result });
      } catch (error) {
        return errorResponse(
          `Error adjusting dnd5e stats: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return undefined;
  };
}

export const dnd5eModule: SystemToolModule = {
  id: "dnd5e",
  label: "Dungeons & Dragons 5e",
  tools: [rollCheckTool, adjustStatsTool],
  createHandler,
};
