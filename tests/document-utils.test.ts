import {
  filterDocumentFields,
  filterDocumentsByWhere,
  truncateDocuments,
} from "../src/core/document-utils.js";

describe("document utils", () => {
  test("filterDocumentFields returns original when requestedFields empty", () => {
    const doc = { _id: "1", name: "A", extra: 1 };
    expect(filterDocumentFields(doc, null)).toBe(doc);
    expect(filterDocumentFields(doc, [])).toBe(doc);
  });

  test("filterDocumentFields includes requested and required fields", () => {
    const doc = { _id: "1", name: "A", extra: 1, skip: true };
    expect(filterDocumentFields(doc, ["extra"]))
      .toEqual({ _id: "1", name: "A", extra: 1 });
  });

  test("filterDocumentFields ignores missing fields", () => {
    const doc = { _id: "1", name: "A" };
    expect(filterDocumentFields(doc, ["missing"]))
      .toEqual({ _id: "1", name: "A" });
  });

  test("truncateDocuments keeps docs under limit", () => {
    const docs = [{ a: 1 }, { b: 2 }];
    const maxLength = Buffer.byteLength(JSON.stringify(docs), "utf-8");
    expect(truncateDocuments(docs, maxLength)).toEqual(docs);
  });

  test("truncateDocuments removes until under limit", () => {
    const docs = [{ a: "a".repeat(50) }, { b: "b".repeat(50) }];
    const maxLength = Buffer.byteLength(JSON.stringify([docs[0]]), "utf-8");
    expect(truncateDocuments(docs, maxLength)).toEqual([docs[0]]);
  });

  test("truncateDocuments returns empty when too small", () => {
    const docs = [{ a: "a" }];
    expect(truncateDocuments(docs, 1)).toEqual([]);
  });

  test("filterDocumentsByWhere returns original when no filter", () => {
    const docs = [{ a: 1 }];
    expect(filterDocumentsByWhere(docs, null)).toBe(docs);
    expect(filterDocumentsByWhere(docs, {})).toBe(docs);
  });

  test("filterDocumentsByWhere filters by all keys", () => {
    const docs = [
      { type: "npc", folder: "f1" },
      { type: "npc", folder: "f2" },
      { type: "pc", folder: "f1" },
    ];
    expect(filterDocumentsByWhere(docs, { type: "npc", folder: "f1" }))
      .toEqual([{ type: "npc", folder: "f1" }]);
  });

  describe("where: dotted paths and operators", () => {
    const docs = [
      { _id: "a", name: "Riar Starport", flags: { "campaign-codex": { type: "location" } }, folder: "f1" },
      { _id: "b", name: "Jerserra", flags: { "campaign-codex": { type: "npc" } }, folder: null },
      { _id: "c", name: "Halyard", flags: {}, folder: "f2" },
    ];

    test("dotted path into flags", () => {
      expect(filterDocumentsByWhere(docs, { "flags.campaign-codex.type": "npc" }))
        .toEqual([docs[1]]);
    });

    test("__in operator", () => {
      expect(filterDocumentsByWhere(docs, { _id__in: ["a", "c"] })).toEqual([docs[0], docs[2]]);
      expect(filterDocumentsByWhere(docs, { _id__in: "a" })).toEqual([]);
    });

    test("__contains operator (case-insensitive substring)", () => {
      expect(filterDocumentsByWhere(docs, { name__contains: "riar" })).toEqual([docs[0]]);
      expect(filterDocumentsByWhere(docs, { name__contains: "RIAR" })).toEqual([docs[0]]);
    });

    test("__ne operator", () => {
      expect(filterDocumentsByWhere(docs, { folder__ne: null })).toEqual([docs[0], docs[2]]);
    });

    test("__exists operator", () => {
      expect(filterDocumentsByWhere(docs, { "flags.campaign-codex__exists": true }))
        .toEqual([docs[0], docs[1]]);
      expect(filterDocumentsByWhere(docs, { "flags.campaign-codex__exists": false }))
        .toEqual([docs[2]]);
    });

    test("missing path never equals a value", () => {
      expect(filterDocumentsByWhere(docs, { "flags.nope.deep": "x" })).toEqual([]);
    });

    test("plain equality still works (rétrocompatibilité)", () => {
      expect(filterDocumentsByWhere(docs, { folder: "f2" })).toEqual([docs[2]]);
    });
  });
});
