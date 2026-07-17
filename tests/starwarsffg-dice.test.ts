import { rollFfgPool, formatPool, formatResult } from "../src/systems/starwarsffg/dice.js";

describe("ffg-dice", () => {
  // rng déterministe : renvoie les valeurs données en séquence
  const seq = (...vals: number[]) => {
    let i = 0;
    return () => vals[i++ % vals.length];
  };

  test("un dé de compétence face pleine réussite", () => {
    // ability face index 3 (sur 8) = double succès → rng = 3/8
    const r = rollFfgPool({ ability: 1 }, seq(3 / 8));
    expect(r.successes).toBe(2);
    expect(r.netSuccesses).toBe(2);
    expect(r.isSuccess).toBe(true);
  });

  test("triomphe compte aussi comme succès", () => {
    // proficiency face index 11 (sur 12) = triomphe → rng = 11/12
    const r = rollFfgPool({ proficiency: 1 }, seq(11 / 12));
    expect(r.triumphs).toBe(1);
    expect(r.successes).toBe(1);
    expect(r.isSuccess).toBe(true);
  });

  test("désespoir compte aussi comme échec", () => {
    const r = rollFfgPool({ challenge: 1 }, seq(11 / 12));
    expect(r.despairs).toBe(1);
    expect(r.failures).toBe(1);
  });

  test("dé de Force : lumière et obscur", () => {
    // face 0 = obscur simple, face 11 = double lumière
    const r = rollFfgPool({ force: 2 }, seq(0, 11 / 12));
    expect(r.dark).toBe(1);
    expect(r.light).toBe(2);
  });

  test("pool opposé : le net se calcule", () => {
    // ability double succès (3/8) vs difficulty double échec (2/8)
    const r = rollFfgPool({ ability: 1, difficulty: 1 }, seq(3 / 8, 2 / 8));
    expect(r.netSuccesses).toBe(0);
    expect(r.isSuccess).toBe(false); // égalité = échec en FFG
  });

  test("statistiques plausibles sur 10000 jets (vrai rng)", () => {
    let successes = 0;
    for (let i = 0; i < 10000; i++) {
      if (rollFfgPool({ ability: 2, difficulty: 1 }).isSuccess) successes++;
    }
    // 2 verts vs 1 pourpre ≈ 68 % de réussite — large tolérance
    expect(successes).toBeGreaterThan(5500);
    expect(successes).toBeLessThan(8000);
  });

  test("formatPool et formatResult", () => {
    expect(formatPool({ ability: 2, proficiency: 1, difficulty: 2 })).toBe("🟩🟩🟨 vs 🟪🟪");
    const r = rollFfgPool({ proficiency: 1 }, seq(11 / 12));
    expect(formatResult(r)).toContain("TRIOMPHE");
    expect(formatResult(r)).toContain("Réussite");
  });

  test("faces détaillées exposées", () => {
    const r = rollFfgPool({ boost: 1 }, seq(4 / 6)); // boost face 4 = double avantage
    expect(r.faces.boost).toEqual(["avantage+avantage"]);
  });
});
