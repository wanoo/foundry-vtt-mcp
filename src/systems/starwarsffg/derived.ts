// systems/starwarsffg/derived.ts
// Réplique du calcul DÉRIVÉ du système starwarsffg : les valeurs affichées sur
// la fiche = valeurs stockées + somme des mods `attributes` portés par
// l'acteur, ses items (espèce, équipement…), les talents APPRIS de ses
// spécialisations et les upgrades appris de ses pouvoirs de la Force.
// (Le document source seul peut afficher 0 partout — piège documenté.)

type Dict = Record<string, unknown>;

export interface AttributeMod {
  mod: string;      // cible, e.g. "Brawn" ou "Vigilance"
  modtype: string;  // "Characteristic" | "Skill Rank" | "Skill Boost" | "Skill Setback" | "Skill Remove Setback" | "Stat" | …
  value: number;
  source: string;   // provenance lisible (nom d'item/talent)
}

function readAttributes(attrs: unknown, source: string): AttributeMod[] {
  if (!attrs || typeof attrs !== "object") return [];
  const out: AttributeMod[] = [];
  for (const entry of Object.values(attrs as Dict)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Dict;
    const value = Number(e.value);
    if (!e.mod || !e.modtype || !Number.isFinite(value) || value === 0) continue;
    out.push({ mod: String(e.mod), modtype: String(e.modtype), value, source });
  }
  return out;
}

/** Collecte TOUS les mods d'attributs actifs d'un acteur (doc source complet). */
export function collectAttributeMods(actor: Dict): AttributeMod[] {
  const mods: AttributeMod[] = [];
  const system = (actor.system as Dict) ?? {};
  mods.push(...readAttributes(system.attributes, "acteur"));

  for (const item of (actor.items as Dict[]) ?? []) {
    const isys = (item.system as Dict) ?? {};
    const name = String(item.name ?? item.type ?? "item");
    // Équipement : seuls les objets équipés/portés comptent pour armure & co,
    // mais le système applique les attributes de tous les items non exclus.
    mods.push(...readAttributes(isys.attributes, name));

    // Talents appris des arbres de spécialisation.
    if (item.type === "specialization") {
      for (const talent of Object.values((isys.talents as Dict) ?? {})) {
        const t = talent as Dict;
        if (t?.islearned) {
          mods.push(...readAttributes(t.attributes, `talent ${t.name ?? "?"}`));
        }
      }
    }
    // Upgrades appris des pouvoirs de la Force.
    if (item.type === "forcepower") {
      for (const [key, upgrade] of Object.entries(isys)) {
        if (!key.startsWith("upgrade")) continue;
        const u = upgrade as Dict;
        if (u?.islearned) {
          mods.push(...readAttributes(u.attributes, `pouvoir ${u.name ?? key}`));
        }
      }
    }
  }
  return mods;
}

function sumMods(mods: AttributeMod[], modtype: string, target: string): number {
  return mods
    .filter((m) => m.modtype === modtype && m.mod === target)
    .reduce((acc, m) => acc + m.value, 0);
}

/** Caractéristique dérivée (valeur stockée + mods "Characteristic"). */
export function deriveCharacteristic(actor: Dict, name: string, mods?: AttributeMod[]): number {
  const system = (actor.system as Dict) ?? {};
  const stored = Number(((system.characteristics as Dict)?.[name] as Dict)?.value) || 0;
  return stored + sumMods(mods ?? collectAttributeMods(actor), "Characteristic", name);
}

export interface DerivedSkill {
  skill: string;
  characteristic: string;
  characteristicValue: number;
  rank: number;
  /** Pool FFG : jaunes = min(carac, rang), verts = max - min. */
  proficiency: number;
  ability: number;
  boost: number;
  setback: number;         // setbacks AJOUTÉS par des mods (rare)
  removeSetback: number;   // setbacks à retirer du pool adverse
  sources: string[];       // provenances des mods appliqués
}

/** Compétence dérivée + pool de dés positif (avec boosts/setbacks de talents). */
export function deriveSkillPool(actor: Dict, skillName: string): DerivedSkill | null {
  const system = (actor.system as Dict) ?? {};
  const skills = (system.skills as Dict) ?? {};
  // Résolution insensible à la casse (« perception » → « Perception »)
  const key = Object.keys(skills).find((k) => k.toLowerCase() === skillName.toLowerCase());
  if (!key) return null;
  const skill = skills[key] as Dict;
  const characteristic = String(skill.characteristic ?? "Brawn");

  const mods = collectAttributeMods(actor);
  const characteristicValue = deriveCharacteristic(actor, characteristic, mods);
  const rank = (Number(skill.rank) || 0) + sumMods(mods, "Skill Rank", key);
  const proficiency = Math.min(characteristicValue, rank);
  const ability = Math.max(characteristicValue, rank) - proficiency;
  const relevant = mods.filter(
    (m) => m.mod === key || (m.modtype === "Characteristic" && m.mod === characteristic)
  );

  return {
    skill: key,
    characteristic,
    characteristicValue,
    rank,
    proficiency,
    ability,
    boost: sumMods(mods, "Skill Boost", key),
    setback: sumMods(mods, "Skill Setback", key),
    removeSetback: sumMods(mods, "Skill Remove Setback", key),
    sources: [...new Set(relevant.map((m) => `${m.source} (${m.modtype} ${m.value >= 0 ? "+" : ""}${m.value})`))],
  };
}
