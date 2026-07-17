import { createResourceHandlers } from "../src/server-resources.js";

function makeClient(actors: any[], journals: any[]) {
  return {
    getDocuments: jest.fn().mockImplementation(async (collection: string) =>
      collection === "actors" ? actors : journals
    ),
    getDocument: jest.fn().mockImplementation(async (collection: string, ident: any) => {
      const pool = collection === "actors" ? actors : journals;
      return pool.find((d) => d._id === ident._id) ?? null;
    }),
  } as any;
}

describe("server-resources", () => {
  const actors = [{ _id: "a1", name: "Uchebe" }, { _id: "a2", name: "Edeker" }];
  const journals = Array.from({ length: 150 }, (_, i) => ({
    _id: `j${i}`,
    name: `Journal ${i}`,
    pages: [{ name: "Page", text: { content: `<p>contenu ${i}</p>` } }],
    ...(i === 0 ? { flags: { "campaign-codex": { type: "npc", data: { description: "x" } } } } : {}),
  }));

  test("list: première page = acteurs, curseur vers les journaux", async () => {
    const { list } = createResourceHandlers(makeClient(actors, journals));
    const page1 = await list();
    expect(page1.resources).toHaveLength(2);
    expect(page1.resources[0]).toMatchObject({ uri: "foundry://actors/a1", name: "Uchebe", mimeType: "application/json" });
    expect(page1.nextCursor).toBe("j:0");
  });

  test("list: pagination des journaux par curseur", async () => {
    const { list } = createResourceHandlers(makeClient(actors, journals));
    const page2 = await list("j:0");
    expect(page2.resources).toHaveLength(100);
    expect(page2.nextCursor).toBe("j:100");
    const page3 = await list("j:100");
    expect(page3.resources).toHaveLength(50);
    expect(page3.nextCursor).toBeUndefined();
  });

  test("list: curseur invalide", async () => {
    const { list } = createResourceHandlers(makeClient(actors, journals));
    await expect(list("zzz:0")).rejects.toThrow("Invalid cursor");
  });

  test("read: acteur en JSON", async () => {
    const { read } = createResourceHandlers(makeClient(actors, journals));
    const res = await read("foundry://actors/a1");
    expect(res.contents[0].mimeType).toBe("application/json");
    expect(JSON.parse(res.contents[0].text)).toMatchObject({ _id: "a1", name: "Uchebe" });
  });

  test("read: journal en HTML, fiche CC en complément JSON", async () => {
    const { read } = createResourceHandlers(makeClient(actors, journals));
    const res = await read("foundry://journal/j0");
    expect(res.contents[0].mimeType).toBe("text/html");
    expect(res.contents[0].text).toContain("<h1>Journal 0</h1>");
    expect(res.contents[0].text).toContain("<p>contenu 0</p>");
    expect(res.contents[1].mimeType).toBe("application/json");
    expect(JSON.parse(res.contents[1].text)).toMatchObject({ type: "npc" });
    // journal sans flags CC : un seul contenu
    const plain = await read("foundry://journal/j1");
    expect(plain.contents).toHaveLength(1);
  });

  test("read: URI inconnue ou document absent", async () => {
    const { read } = createResourceHandlers(makeClient(actors, journals));
    await expect(read("http://evil")).rejects.toThrow("Unknown resource URI");
    await expect(read("foundry://actors/nope")).rejects.toThrow("Resource not found");
  });
});
