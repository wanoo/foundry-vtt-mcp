import { rollD20, abilityModifier, proficiencyBonus, formatD20 } from "../src/systems/dnd5e/dice.js";
import { dnd5eModule } from "../src/systems/dnd5e/index.js";

const seq = (...vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

describe("dnd5e/dice", () => {
  test("modificateurs et bonus de maîtrise SRD", () => {
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(15)).toBe(2);
    expect(abilityModifier(8)).toBe(-1);
    expect(proficiencyBonus(1)).toBe(2);
    expect(proficiencyBonus(5)).toBe(3);
    expect(proficiencyBonus(17)).toBe(6);
  });

  test("avantage garde le meilleur, désavantage le pire, les deux s'annulent", () => {
    // rng 0.2 → d20 5 ; rng 0.8 → d20 17
    expect(rollD20({ advantage: true }, seq(0.2, 0.8)).kept).toBe(17);
    expect(rollD20({ disadvantage: true }, seq(0.2, 0.8)).kept).toBe(5);
    const both = rollD20({ advantage: true, disadvantage: true }, seq(0.2, 0.8));
    expect(both.rolls).toHaveLength(1);
  });

  test("20 naturel réussit toujours, 1 naturel échoue toujours", () => {
    const nat20 = rollD20({ modifier: -10, dc: 30 }, seq(19.5 / 20));
    expect(nat20.crit).toBe(true);
    expect(nat20.success).toBe(true);
    const nat1 = rollD20({ modifier: 50, dc: 5 }, seq(0));
    expect(nat1.fumble).toBe(true);
    expect(nat1.success).toBe(false);
  });

  test("test contre DD et format", () => {
    const r = rollD20({ modifier: 5, dc: 15 }, seq(11.5 / 20)); // d20 = 12
    expect(r.total).toBe(17);
    expect(r.success).toBe(true);
    expect(formatD20(r)).toContain("= 17");
    expect(formatD20(r)).toContain("réussite");
  });
});

describe("module dnd5e", () => {
  const handler = (client: any) => dnd5eModule.createHandler(client);
  const ACTOR = {
    _id: "a1", name: "Bruenor",
    system: {
      abilities: { str: { value: 16, proficient: 1 }, wis: { value: 12, proficient: 0 } },
      skills: { ath: { value: 1, ability: "str" }, prc: { value: 2, ability: "wis" } },
      attributes: { hp: { value: 20, max: 30, temp: 0 }, exhaustion: 0 },
      details: { level: 5, xp: { value: 6500 } },
      currency: { gp: 50 },
    },
  };

  test("dnd5e_roll_check : compétence avec expertise", async () => {
    const client = {
      getUserId: () => "bot1",
      getDocument: jest.fn().mockResolvedValue(ACTOR),
      createDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
    const response = await handler(client)({
      params: { name: "dnd5e_roll_check", arguments: { actor: "Bruenor", check: "perception", dc: 10, post: false } },
    });
    const body = JSON.parse((response as any).content[0].text);
    // Sagesse 12 (+1) + expertise (2 × prof 3) = +7
    expect(body.modifier).toBe(7);
    expect(body.check).toBe("Perception");
  });

  test("dnd5e_roll_check : sauvegarde maîtrisée", async () => {
    const client = {
      getUserId: () => "bot1",
      getDocument: jest.fn().mockResolvedValue(ACTOR),
      createDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
    const response = await handler(client)({
      params: { name: "dnd5e_roll_check", arguments: { actor: "a1", check: "str_save", post: false } },
    });
    const body = JSON.parse((response as any).content[0].text);
    // Force 16 (+3) + prof 3 = +6
    expect(body.modifier).toBe(6);
    expect(body.check).toContain("Strength");
  });

  test("dnd5e_adjust_stats : dégâts avec plafond aux PV max", async () => {
    const client = {
      getDocument: jest.fn().mockResolvedValue(ACTOR),
      modifyDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
    const response = await handler(client)({
      params: { name: "dnd5e_adjust_stats", arguments: { actor: "Bruenor", hp: 25, gp: -20 } },
    });
    const body = JSON.parse((response as any).content[0].text);
    expect(body.changes.hp).toEqual({ before: 20, after: 30 }); // plafonné au max
    expect(body.changes.gp).toEqual({ before: 50, after: 30 });
    expect(client.modifyDocument).toHaveBeenCalledWith("Actor", "a1", [
      { "system.attributes.hp.value": 30, "system.currency.gp": 30 },
    ]);
  });

  test("laisse passer les outils inconnus", async () => {
    expect(await handler({} as any)({ params: { name: "get_actors", arguments: {} } })).toBeUndefined();
  });
});
