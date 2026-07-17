import { rollDuality, formatDuality } from "../src/systems/daggerheart/dice.js";
import { daggerheartModule } from "../src/systems/daggerheart/index.js";

const seq = (...vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};
// rng x → d12 = 1 + floor(x*12) ; pour obtenir n : (n-1)/12
const d12 = (n: number) => (n - 1) / 12;
const d6 = (n: number) => (n - 1) / 6;

describe("daggerheart/dice", () => {
  test("avec Espoir / avec Peur", () => {
    const hope = rollDuality({ modifier: 2, difficulty: 12 }, seq(d12(8), d12(5)));
    expect(hope).toMatchObject({ hope: 8, fear: 5, total: 15, withHope: true, success: true });
    const fear = rollDuality({ difficulty: 12 }, seq(d12(3), d12(9)));
    expect(fear).toMatchObject({ withFear: true, total: 12, success: true });
  });

  test("doubles = réussite critique même sous la difficulté", () => {
    const crit = rollDuality({ modifier: 0, difficulty: 20 }, seq(d12(4), d12(4)));
    expect(crit.isCritical).toBe(true);
    expect(crit.success).toBe(true);
    expect(formatDuality(crit)).toContain("CRITIQUE");
  });

  test("avantage ajoute un d6, désavantage le retranche, annulation mutuelle", () => {
    const adv = rollDuality({ advantage: true }, seq(d12(6), d12(3), d6(4)));
    expect(adv.advantageDie).toBe(4);
    expect(adv.total).toBe(13);
    const dis = rollDuality({ disadvantage: true }, seq(d12(6), d12(3), d6(4)));
    expect(dis.advantageDie).toBe(-4);
    expect(dis.total).toBe(5);
    const both = rollDuality({ advantage: true, disadvantage: true }, seq(d12(6), d12(3)));
    expect(both.advantageDie).toBeNull();
  });

  test("échec avec Peur formaté", () => {
    const r = rollDuality({ modifier: 0, difficulty: 18 }, seq(d12(2), d12(7)));
    expect(r.success).toBe(false);
    expect(formatDuality(r)).toContain("Échec avec Peur");
  });
});

describe("module daggerheart", () => {
  const handler = (client: any) => daggerheartModule.createHandler(client);
  const ACTOR = {
    _id: "a1", name: "Théa",
    system: {
      traits: { instinct: { value: 2 }, agility: { value: 1 } },
      resources: {
        hitPoints: { value: 2, max: 6 },
        stress: { value: 1, max: 6 },
        hope: { value: 3, max: 6 },
      },
    },
  };

  test("dh_roll_actor_trait lit le trait de la fiche", async () => {
    const client = {
      getUserId: () => "bot1",
      getDocument: jest.fn().mockResolvedValue(ACTOR),
      createDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
    const response = await handler(client)({
      params: { name: "dh_roll_actor_trait", arguments: { actor: "Théa", trait: "instinct", difficulty: 13, post: false } },
    });
    const body = JSON.parse((response as any).content[0].text);
    expect(body.modifier).toBe(2);
    expect(body.actor.name).toBe("Théa");
    expect(typeof body.total).toBe("number");
  });

  test("dh_roll_duality poste en chat", async () => {
    const client = {
      getUserId: () => "bot1",
      createDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
    const response = await handler(client)({
      params: { name: "dh_roll_duality", arguments: { description: "Percer le mensonge", modifier: 1 } },
    });
    const body = JSON.parse((response as any).content[0].text);
    expect(body.posted).toBe(true);
    expect(client.createDocument).toHaveBeenCalledWith("ChatMessage", [
      expect.objectContaining({ content: expect.stringContaining("Percer le mensonge") }),
    ]);
  });

  test("dh_adjust_stats borne aux max des ressources", async () => {
    const client = {
      getDocument: jest.fn().mockResolvedValue(ACTOR),
      modifyDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
    const response = await handler(client)({
      params: { name: "dh_adjust_stats", arguments: { actor: "a1", hit_points: 10, hope: -1 } },
    });
    const body = JSON.parse((response as any).content[0].text);
    expect(body.changes.hit_points).toEqual({ before: 2, after: 6 }); // borné à max 6
    expect(body.changes.hope).toEqual({ before: 3, after: 2 });
    expect(client.modifyDocument).toHaveBeenCalledWith("Actor", "a1", [
      { "system.resources.hitPoints.value": 6, "system.resources.hope.value": 2 },
    ]);
  });

  test("trait inconnu → erreur", async () => {
    const response = await handler({ getDocument: jest.fn().mockResolvedValue(ACTOR) } as any)({
      params: { name: "dh_roll_actor_trait", arguments: { actor: "a1", trait: "charisme" } },
    });
    expect((response as any).isError).toBe(true);
  });

  test("laisse passer les outils inconnus", async () => {
    expect(await handler({} as any)({ params: { name: "roll_ffg_pool", arguments: {} } })).toBeUndefined();
  });
});
