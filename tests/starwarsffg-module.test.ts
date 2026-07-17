import { starwarsffgModule } from "../src/systems/starwarsffg/index.js";
import { loadSystemModules, ALL_SYSTEM_MODULES } from "../src/systems/index.js";

describe("systems registry", () => {
  test("tous les modules chargés par défaut", () => {
    expect(loadSystemModules({} as any).map((m) => m.id)).toEqual(
      ALL_SYSTEM_MODULES.map((m) => m.id)
    );
  });

  test("FOUNDRY_SYSTEMS restreint la sélection", () => {
    expect(loadSystemModules({ FOUNDRY_SYSTEMS: "starwarsffg" } as any).map((m) => m.id))
      .toEqual(["starwarsffg"]);
    expect(loadSystemModules({ FOUNDRY_SYSTEMS: "dnd5e" } as any).map((m) => m.id))
      .toEqual(["dnd5e"]);
    expect(loadSystemModules({ FOUNDRY_SYSTEMS: "pf2e" } as any)).toEqual([]);
    expect(loadSystemModules({ FOUNDRY_SYSTEMS: "" } as any)).toEqual([]);
  });

  test("trois modules embarqués, outils préfixés sans collision", () => {
    const ids = ALL_SYSTEM_MODULES.map((m) => m.id);
    expect(ids).toEqual(["starwarsffg", "dnd5e", "daggerheart"]);
    const names = ALL_SYSTEM_MODULES.flatMap((m) => m.tools.map((t) => t.name));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("module starwarsffg", () => {
  const handler = (client: any) => starwarsffgModule.createHandler(client);

  test("expose ses 7 outils", () => {
    expect(starwarsffgModule.tools.map((t) => t.name)).toEqual([
      "request_player_roll",
      "roll_ffg_pool",
      "adjust_actor_stats",
      "roll_actor_skill",
      "adjust_destiny",
      "grant_xp",
      "apply_critical_injury",
    ]);
  });

  test("roll_actor_skill dérive le pool depuis la fiche et poste", async () => {
    const actor = {
      _id: "a1", name: "Pahas'Tis",
      system: {
        characteristics: { Willpower: { value: 0 } },
        skills: { Vigilance: { rank: 0, characteristic: "Willpower" } },
        attributes: {},
      },
      items: [
        { name: "Twi’lek", type: "species", system: { attributes: { W: { mod: "Willpower", modtype: "Characteristic", value: 2 } } } },
      ],
    };
    const client = {
      getUserId: () => "bot1",
      getDocument: jest.fn().mockResolvedValue(actor),
      createDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
    const response = await handler(client)({
      params: { name: "roll_actor_skill", arguments: { actor: "Pahas'Tis", skill: "vigilance", difficulty: 2 } },
    });
    const body = JSON.parse((response as any).content[0].text);
    expect(body.derivation).toMatchObject({ characteristicValue: 2, ability: 2, proficiency: 0 });
    expect(body.pool).toBe("🟩🟩 vs 🟪🟪");
    expect(body.posted).toBe(true);
    expect(client.createDocument).toHaveBeenCalledWith("ChatMessage", [
      expect.objectContaining({ content: expect.stringContaining("Vigilance") }),
    ]);
  });

  test("adjust_destiny spend_light convertit le point", async () => {
    const client = {
      getSettings: jest.fn().mockResolvedValue([
        { _id: "s1", key: "starwarsffg.dPoolLight", value: "2" },
        { _id: "s2", key: "starwarsffg.dPoolDark", value: "1" },
      ]),
      modifyDocument: jest.fn().mockResolvedValue({ ok: true }),
      createDocument: jest.fn(),
    } as any;
    const response = await handler(client)({
      params: { name: "adjust_destiny", arguments: { action: "spend_light" } },
    });
    const body = JSON.parse((response as any).content[0].text);
    expect(body).toMatchObject({ light: 1, dark: 2, before: { light: 2, dark: 1 } });
    expect(client.modifyDocument).toHaveBeenCalledWith("Setting", "s1", [{ value: "1" }]);
    expect(client.modifyDocument).toHaveBeenCalledWith("Setting", "s2", [{ value: "2" }]);
  });

  test("adjust_destiny crée les settings absents (set)", async () => {
    const client = {
      getSettings: jest.fn().mockResolvedValue([]),
      modifyDocument: jest.fn(),
      createDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
    await handler(client)({
      params: { name: "adjust_destiny", arguments: { action: "set", light: 3, dark: 1 } },
    });
    expect(client.createDocument).toHaveBeenCalledWith("Setting", [{ key: "starwarsffg.dPoolLight", value: "3" }]);
    expect(client.createDocument).toHaveBeenCalledWith("Setting", [{ key: "starwarsffg.dPoolDark", value: "1" }]);
  });

  test("grant_xp cible les PJ par défaut et incrémente total+available", async () => {
    const client = {
      getDocuments: jest.fn().mockResolvedValue([
        { _id: "a1", name: "Uchebe", system: { experience: { available: 10, total: 200 } } },
      ]),
      modifyDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
    const response = await handler(client)({
      params: { name: "grant_xp", arguments: { amount: 15 } },
    });
    expect(client.getDocuments).toHaveBeenCalledWith("actors", expect.objectContaining({
      where: { type: "character" },
    }));
    expect(client.modifyDocument).toHaveBeenCalledWith("Actor", "a1", [
      { "system.experience.available": 25, "system.experience.total": 215 },
    ]);
    const body = JSON.parse((response as any).content[0].text);
    expect(body.granted[0]).toMatchObject({ name: "Uchebe", available: 25, total: 215 });
  });

  test("apply_critical_injury : +10 par blessure existante, résout et attache l'item", async () => {
    const client = {
      getUserId: () => "bot1",
      getDocument: jest.fn().mockImplementation(async (collection: string) =>
        collection === "actors"
          ? { _id: "a1", name: "Vendeur", items: [{ type: "criticalinjury", name: "Ancienne" }] }
          : null
      ),
      getDocuments: jest.fn().mockResolvedValue([{
        _id: "tb1", name: "🩸 Blessures critiques (d100)", formula: "1d100",
        results: [{ range: [1, 200], description: "@UUID[Compendium.world.critical-injury-list.xYz123]{Sonné} · Facile" }],
      }]),
      getPackDocuments: jest.fn().mockResolvedValue([{ _id: "xYz123", name: "Sonné", type: "criticalinjury" }]),
      createDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
    const response = await handler(client)({
      params: { name: "apply_critical_injury", arguments: { actor: "Vendeur" } },
    });
    const body = JSON.parse((response as any).content[0].text);
    expect(body.modifier).toBe(10); // 1 blessure existante
    expect(body.roll).toBeGreaterThanOrEqual(11);
    expect(body.attached).toEqual({ name: "Sonné" });
    expect(client.getPackDocuments).toHaveBeenCalledWith("Item", "world.critical-injury-list", { query: { _id: "xYz123" } });
    expect(client.createDocument).toHaveBeenCalledWith("Item", [expect.objectContaining({ name: "Sonné" })], { parentUuid: "Actor.a1" });
  });

  test("laisse passer les outils inconnus", async () => {
    const res = await handler({} as any)({ params: { name: "get_actors", arguments: {} } });
    expect(res).toBeUndefined();
  });

  test("request_player_roll posts an FFG pool chat message", async () => {
    const client = {
      getUserId: () => "bot1",
      createDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
    const response = await handler(client)({
      params: {
        name: "request_player_roll",
        arguments: { description: "Test de Peur", difficulty: 2, challenge: 1, skill_name: "Discipline" },
      },
    });
    expect(client.createDocument).toHaveBeenCalledWith("ChatMessage", [
      expect.objectContaining({
        author: "bot1",
        content: expect.stringContaining("ffg-pool-to-player"),
        flags: {
          starwarsffg: expect.objectContaining({
            dicePool: { difficulty: 2, challenge: 1 },
            description: "Test de Peur",
            roll: expect.objectContaining({ skillName: "Discipline" }),
          }),
        },
      }),
    ]);
    expect((response as any).isError).toBeUndefined();
  });

  test("request_player_roll supports whisper", async () => {
    const client = {
      getUserId: () => "bot1",
      createDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
    await handler(client)({
      params: {
        name: "request_player_roll",
        arguments: { description: "Perception", ability: 2, whisper_users: ["u1"] },
      },
    });
    expect(client.createDocument).toHaveBeenCalledWith("ChatMessage", [
      expect.objectContaining({ whisper: ["u1"] }),
    ]);
  });

  test("roll_ffg_pool posts a chat message with the result", async () => {
    const client = {
      getUserId: () => "bot1",
      createDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
    const response = await handler(client)({
      params: { name: "roll_ffg_pool", arguments: { description: "Perception", ability: 2, difficulty: 1 } },
    });
    expect(client.createDocument).toHaveBeenCalledWith("ChatMessage", [
      expect.objectContaining({ author: "bot1", content: expect.stringContaining("Perception") }),
    ]);
    const body = JSON.parse((response as any).content[0].text);
    expect(body.detail).toHaveProperty("netSuccesses");
    expect(body.posted).toBe(true);
  });

  test("adjust_actor_stats applique des deltas avec plancher à 0", async () => {
    const client = {
      getDocument: jest.fn().mockResolvedValue({
        _id: "a1",
        name: "Uchebe",
        system: { stats: { wounds: { value: 3 }, strain: { value: 1 }, credits: { value: 100 } }, experience: { available: 10, total: 200 } },
      }),
      modifyDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
    const response = await handler(client)({
      params: { name: "adjust_actor_stats", arguments: { actor: "Uchebe", wounds: 2, strain: -5, credits: -30 } },
    });
    expect(client.modifyDocument).toHaveBeenCalledWith("Actor", "a1", [{
      "system.stats.wounds.value": 5,
      "system.stats.strain.value": 0, // 1 - 5 → plancher 0
      "system.stats.credits.value": 70,
    }]);
    const body = JSON.parse((response as any).content[0].text);
    expect(body.changes.wounds).toEqual({ before: 3, after: 5 });
    expect(body.mode).toBe("delta");
  });

  test("adjust_actor_stats en mode set", async () => {
    const client = {
      getDocument: jest.fn().mockResolvedValue({
        _id: "a1", name: "Uchebe",
        system: { experience: { available: 10, total: 200 } },
      }),
      modifyDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
    await handler(client)({
      params: { name: "adjust_actor_stats", arguments: { actor: "a1", xp_available: 25, set: true } },
    });
    expect(client.modifyDocument).toHaveBeenCalledWith("Actor", "a1", [{
      "system.experience.available": 25,
    }]);
  });

  test("adjust_actor_stats exige au moins une stat", async () => {
    const response = await handler({} as any)({
      params: { name: "adjust_actor_stats", arguments: { actor: "Uchebe" } },
    });
    expect((response as any).isError).toBe(true);
  });
});
