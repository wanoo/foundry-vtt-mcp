// systems/dnd5e/dice.ts
// Moteur d20 (SRD 5e) : avantage/désavantage, critiques, test contre DD.
export interface D20Options {
  modifier?: number;
  advantage?: boolean;
  disadvantage?: boolean;
  dc?: number | null;
}

export interface D20Result {
  rolls: number[];       // les d20 lancés (1 ou 2)
  kept: number;          // le dé retenu
  modifier: number;
  total: number;
  crit: boolean;         // 20 naturel
  fumble: boolean;       // 1 naturel
  success: boolean | null; // null si pas de DD
}

export function rollD20(options: D20Options = {}, rng: () => number = Math.random): D20Result {
  const d20 = () => 1 + Math.floor(rng() * 20);
  const modifier = options.modifier ?? 0;
  // Avantage ET désavantage s'annulent (règle SRD).
  const adv = Boolean(options.advantage) && !options.disadvantage;
  const dis = Boolean(options.disadvantage) && !options.advantage;
  const rolls = adv || dis ? [d20(), d20()] : [d20()];
  const kept = adv ? Math.max(...rolls) : dis ? Math.min(...rolls) : rolls[0];
  const total = kept + modifier;
  const dc = options.dc ?? null;
  return {
    rolls,
    kept,
    modifier,
    total,
    crit: kept === 20,
    fumble: kept === 1,
    success: dc === null ? null : kept === 20 ? true : kept === 1 ? false : total >= dc,
  };
}

/** Modificateur de caractéristique 5e : floor((score − 10) / 2). */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Bonus de maîtrise 5e : 2 + floor((niveau − 1) / 4). */
export function proficiencyBonus(level: number): number {
  return 2 + Math.floor((Math.max(level, 1) - 1) / 4);
}

export function formatD20(r: D20Result): string {
  const dice = r.rolls.length === 2 ? `[${r.rolls.join(", ")}] → ${r.kept}` : `${r.kept}`;
  const sign = r.modifier >= 0 ? "+" : "";
  const outcome =
    r.success === null ? "" : r.success ? " · ✅ réussite" : " · ❌ échec";
  const special = r.crit ? " · ⭐ CRITIQUE" : r.fumble ? " · 💀 ÉCHEC CRITIQUE" : "";
  return `d20 ${dice} ${sign}${r.modifier} = ${r.total}${outcome}${special}`;
}
