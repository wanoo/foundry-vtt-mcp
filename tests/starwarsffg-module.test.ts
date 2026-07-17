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
    expect(loadSystemModules({ FOUNDRY_SYSTEMS: "dnd5e" } as any)).toEqual([]);
    expect(loadSystemModules({ FOUNDRY_SYSTEMS: "" } as any)).toEqual([]);
  });
});

describe("module starwarsffg", () => {
  const handler = (client: any) => starwarsffgModule.createHandler(client);

  test("expose ses 3 outils", () => {
    expect(starwarsffgModule.tools.map((t) => t.name)).toEqual([
      "request_player_roll",
      "roll_ffg_pool",
      "adjust_actor_stats",
    ]);
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
