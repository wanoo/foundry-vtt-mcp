import { createPromptHandlers, PROMPT_DEFINITIONS } from "../src/server-prompts.js";

describe("server-prompts", () => {
  test("trois prompts déclarés", () => {
    expect(PROMPT_DEFINITIONS.map((p) => p.name)).toEqual([
      "session-recap",
      "world-overview",
      "prep-checklist",
    ]);
  });

  test("session-recap injecte les derniers messages", async () => {
    const client = {
      getDocuments: jest.fn().mockResolvedValue([
        { content: "<p>message-hors-fenetre</p>", flavor: "" },
        { content: "<p>Jet de <strong>Perception</strong></p>", flavor: "Uchebe" },
      ]),
    } as any;
    const { get } = createPromptHandlers(client);
    const res = await get("session-recap", { max_messages: "1" });
    const text = res.messages[0].content.text;
    expect(text).toContain("[Uchebe] Jet de **Perception**");
    expect(text).not.toContain("message-hors-fenetre");
    expect(text).toContain("résumé de séance");
  });

  test("world-overview injecte statut + scène + combats", async () => {
    const client = {
      getStatus: jest.fn().mockResolvedValue({ server: { world: "star-wars", system: "starwarsffg", version: "13.351", users: 2 } }),
      getDocuments: jest.fn().mockImplementation(async (c: string) =>
        c === "scenes" ? [{ _id: "s1", name: "Toydaria" }] : []
      ),
    } as any;
    const { get } = createPromptHandlers(client);
    const res = await get("world-overview", undefined);
    const text = res.messages[0].content.text;
    expect(text).toContain("star-wars");
    expect(text).toContain("Toydaria");
    expect(text).toContain("Combats en cours : 0");
  });

  test("prep-checklist liste tokens et playlists", async () => {
    const client = {
      getDocument: jest.fn().mockResolvedValue({ _id: "s1", name: "Riar", tokens: [{ name: "Jerserra" }] }),
      getDocuments: jest.fn().mockResolvedValue([{ name: "🎰 Ambiance Sabacc" }]),
    } as any;
    const { get } = createPromptHandlers(client);
    const res = await get("prep-checklist", { scene: "Riar" });
    const text = res.messages[0].content.text;
    expect(text).toContain("Riar");
    expect(text).toContain("Jerserra");
    expect(text).toContain("Ambiance Sabacc");
  });

  test("prompt inconnu → erreur", async () => {
    const { get } = createPromptHandlers({} as any);
    await expect(get("nope", undefined)).rejects.toThrow("Unknown prompt");
  });
});
