// systems/daggerheart/dice.ts
// Dés de Dualité du SRD Daggerheart (Darrington Press) : 2d12 — un dé d'Espoir,
// un dé de Peur — + modificateur, contre une Difficulté.
//   · doubles        → RÉUSSITE CRITIQUE (auto : gagne 1 Espoir, efface 1 Stress)
//   · Espoir > Peur  → « avec Espoir » (le PJ gagne 1 Espoir)
//   · Peur > Espoir  → « avec Peur » (le MJ gagne 1 Peur)
//   · avantage +1d6 au total · désavantage −1d6 (ils se compensent un à un).
export interface DualityOptions {
  modifier?: number;
  difficulty?: number | null;
  advantage?: boolean;
  disadvantage?: boolean;
}

export interface DualityResult {
  hope: number;
  fear: number;
  advantageDie: number | null;   // valeur du d6 (négative si désavantage)
  modifier: number;
  total: number;
  isCritical: boolean;
  withHope: boolean;
  withFear: boolean;
  success: boolean | null;       // null si pas de difficulté
}

export function rollDuality(options: DualityOptions = {}, rng: () => number = Math.random): DualityResult {
  const d12 = () => 1 + Math.floor(rng() * 12);
  const d6 = () => 1 + Math.floor(rng() * 6);
  const modifier = options.modifier ?? 0;
  const hope = d12();
  const fear = d12();
  const adv = Boolean(options.advantage) && !options.disadvantage;
  const dis = Boolean(options.disadvantage) && !options.advantage;
  const advantageDie = adv ? d6() : dis ? -d6() : null;
  const total = hope + fear + modifier + (advantageDie ?? 0);
  const isCritical = hope === fear;
  const difficulty = options.difficulty ?? null;
  return {
    hope,
    fear,
    advantageDie,
    modifier,
    total,
    isCritical,
    withHope: hope > fear,
    withFear: fear > hope,
    success: difficulty === null ? null : isCritical ? true : total >= difficulty,
  };
}

export function formatDuality(r: DualityResult): string {
  const parts = [`Espoir ${r.hope} + Peur ${r.fear}`];
  if (r.advantageDie !== null) {
    parts.push(r.advantageDie >= 0 ? `+ d6 avantage ${r.advantageDie}` : `− d6 désavantage ${-r.advantageDie}`);
  }
  if (r.modifier) parts.push(`${r.modifier >= 0 ? "+" : ""}${r.modifier}`);
  let outcome: string;
  if (r.isCritical) outcome = "⭐ RÉUSSITE CRITIQUE (gagne 1 Espoir, efface 1 Stress)";
  else if (r.success === true) outcome = r.withHope ? "✅ Réussite avec Espoir" : "✅ Réussite avec Peur";
  else if (r.success === false) outcome = r.withHope ? "❌ Échec avec Espoir" : "❌ Échec avec Peur";
  else outcome = r.withHope ? "avec Espoir (+1 Espoir)" : "avec Peur (+1 Peur au MJ)";
  return `${parts.join(" ")} = ${r.total} · ${outcome}`;
}
