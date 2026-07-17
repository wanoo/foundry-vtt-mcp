import { COLLECTION_TO_TYPE, extractPushdownQuery } from "../src/core/collections.js";

describe("collections", () => {
  test("maps every world collection to a document type", () => {
    expect(COLLECTION_TO_TYPE).toMatchObject({
      actors: "Actor",
      journal: "JournalEntry",
      tables: "RollTable",
      messages: "ChatMessage",
      settings: "Setting",
    });
    expect(Object.keys(COLLECTION_TO_TYPE)).toHaveLength(13);
  });

  describe("extractPushdownQuery", () => {
    test("keeps plain top-level equalities", () => {
      expect(extractPushdownQuery({ name: "Riar", folder: "f1" }))
        .toEqual({ name: "Riar", folder: "f1" });
    });

    test("keeps _id__in arrays", () => {
      expect(extractPushdownQuery({ _id__in: ["a", "b"] })).toEqual({ _id__in: ["a", "b"] });
    });

    test("drops operators and dotted paths (client-side only)", () => {
      expect(extractPushdownQuery({
        name__contains: "riar",
        folder__ne: null,
        "flags.campaign-codex.type": "npc",
        "flags.core__exists": true,
        active: true,
      })).toEqual({ active: true });
    });

    test("handles null/empty where", () => {
      expect(extractPushdownQuery(null)).toEqual({});
      expect(extractPushdownQuery({})).toEqual({});
    });
  });
});
