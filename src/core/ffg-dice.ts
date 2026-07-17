// ffg-dice.ts
// Évaluation serveur des dés narratifs Star Wars FFG (faces officielles).
// s=succès f=échec a=avantage t=menace T=triomphe D=désespoir l=lumière d=obscur

export interface FfgPool {
  ability?: number;
  proficiency?: number;
  difficulty?: number;
  challenge?: number;
  boost?: number;
  setback?: number;
  force?: number;
}

export interface FfgResult {
  successes: number;
  failures: number;
  advantages: number;
  threats: number;
  triumphs: number;
  despairs: number;
  light: number;
  dark: number;
  netSuccesses: number;
  netAdvantages: number;
  isSuccess: boolean;
  faces: Record<string, string[]>;
}

type Face = Partial<Record<"s" | "f" | "a" | "t" | "T" | "D" | "l" | "d", number>>;

// Faces officielles FFG (Edge of the Empire / Age of Rebellion / Force and Destiny).
const DICE: Record<keyof FfgPool, Face[]> = {
  boost: [{}, {}, { s: 1 }, { s: 1, a: 1 }, { a: 2 }, { a: 1 }],
  setback: [{}, {}, { f: 1 }, { f: 1 }, { t: 1 }, { t: 1 }],
  ability: [{}, { s: 1 }, { s: 1 }, { s: 2 }, { a: 1 }, { a: 1 }, { s: 1, a: 1 }, { a: 2 }],
  difficulty: [{}, { f: 1 }, { f: 2 }, { t: 1 }, { t: 1 }, { t: 1 }, { t: 2 }, { f: 1, t: 1 }],
  proficiency: [
    {}, { s: 1 }, { s: 1 }, { s: 2 }, { s: 2 }, { a: 1 },
    { s: 1, a: 1 }, { s: 1, a: 1 }, { s: 1, a: 1 }, { a: 2 }, { a: 2 }, { T: 1 },
  ],
  challenge: [
    {}, { f: 1 }, { f: 1 }, { f: 2 }, { f: 2 }, { t: 1 },
    { t: 1 }, { f: 1, t: 1 }, { f: 1, t: 1 }, { t: 2 }, { t: 2 }, { D: 1 },
  ],
  force: [
    { d: 1 }, { d: 1 }, { d: 1 }, { d: 1 }, { d: 1 }, { d: 1 }, { d: 2 },
    { l: 1 }, { l: 1 }, { l: 2 }, { l: 2 }, { l: 2 },
  ],
};

function faceLabel(face: Face): string {
  const parts: string[] = [];
  const NAMES: Record<string, string> = {
    s: "succès", f: "échec", a: "avantage", t: "menace",
    T: "TRIOMPHE", D: "DÉSESPOIR", l: "lumière", d: "obscur",
  };
  for (const [k, n] of Object.entries(face)) {
    for (let i = 0; i < (n ?? 0); i++) parts.push(NAMES[k]);
  }
  return parts.length ? parts.join("+") : "—";
}

/**
 * Roll an FFG narrative dice pool. `rng` returns [0,1) — injectable for tests.
 * Un triomphe compte aussi comme un succès, un désespoir comme un échec
 * (règle officielle) — en PLUS de leur effet narratif propre.
 */
export function rollFfgPool(pool: FfgPool, rng: () => number = Math.random): FfgResult {
  const tally = { s: 0, f: 0, a: 0, t: 0, T: 0, D: 0, l: 0, d: 0 };
  const faces: Record<string, string[]> = {};

  for (const die of Object.keys(DICE) as (keyof FfgPool)[]) {
    const count = pool[die] ?? 0;
    if (count <= 0) continue;
    faces[die] = [];
    for (let i = 0; i < count; i++) {
      const face = DICE[die][Math.floor(rng() * DICE[die].length)];
      faces[die].push(faceLabel(face));
      for (const [k, n] of Object.entries(face)) {
        tally[k as keyof typeof tally] += n ?? 0;
      }
    }
  }

  const successes = tally.s + tally.T;
  const failures = tally.f + tally.D;
  const netSuccesses = successes - failures;
  const netAdvantages = tally.a - tally.t;
  return {
    successes,
    failures,
    advantages: tally.a,
    threats: tally.t,
    triumphs: tally.T,
    despairs: tally.D,
    light: tally.l,
    dark: tally.d,
    netSuccesses,
    netAdvantages,
    isSuccess: netSuccesses > 0,
    faces,
  };
}

const DIE_SYMBOLS: Record<string, string> = {
  ability: "🟩", proficiency: "🟨", boost: "🟦",
  difficulty: "🟪", challenge: "🟥", setback: "⬛", force: "⬜",
};

/** Format the pool composition, e.g. "🟩🟩🟨 vs 🟪🟪". */
export function formatPool(pool: FfgPool): string {
  const pos = (["ability", "proficiency", "boost", "force"] as const)
    .map((d) => DIE_SYMBOLS[d].repeat(pool[d] ?? 0)).join("");
  const neg = (["difficulty", "challenge", "setback"] as const)
    .map((d) => DIE_SYMBOLS[d].repeat(pool[d] ?? 0)).join("");
  return neg ? `${pos || "∅"} vs ${neg}` : pos || "∅";
}

/** Human summary in French, e.g. "✅ Réussite (2 succès nets), 1 avantage, 1 TRIOMPHE". */
export function formatResult(r: FfgResult): string {
  const parts: string[] = [];
  parts.push(
    r.netSuccesses > 0
      ? `✅ Réussite (${r.netSuccesses} succès net${r.netSuccesses > 1 ? "s" : ""})`
      : `❌ Échec (${-r.netSuccesses || 0} échec${-r.netSuccesses > 1 ? "s" : ""} net${-r.netSuccesses > 1 ? "s" : ""})`
  );
  if (r.netAdvantages > 0) parts.push(`${r.netAdvantages} avantage${r.netAdvantages > 1 ? "s" : ""}`);
  if (r.netAdvantages < 0) parts.push(`${-r.netAdvantages} menace${-r.netAdvantages > 1 ? "s" : ""}`);
  if (r.triumphs) parts.push(`${r.triumphs} TRIOMPHE${r.triumphs > 1 ? "S" : ""} ⭐`);
  if (r.despairs) parts.push(`${r.despairs} DÉSESPOIR${r.despairs > 1 ? "S" : ""} 💀`);
  if (r.light) parts.push(`${r.light} lumière ○`);
  if (r.dark) parts.push(`${r.dark} obscur ●`);
  return parts.join(" · ");
}
