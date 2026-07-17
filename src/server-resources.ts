// server-resources.ts
// Ressources MCP : les documents Foundry parcourables/lisibles par les clients
// (resources/list paginé par curseur, resources/read par URI foundry://…).
import type { FoundryClient } from "./foundry-client.js";

const PAGE_SIZE = 100;

export interface ResourceEntry {
  uri: string;
  name: string;
  description?: string;
  mimeType: string;
}

/**
 * Cursor format: "<section>:<offset>" — sections served in order:
 *   a = actors (application/json) · j = journals (text/html).
 * Journals include Campaign Codex sheets (their data is appended on read).
 */
export function createResourceHandlers(foundryClient: FoundryClient) {
  async function list(cursor?: string): Promise<{ resources: ResourceEntry[]; nextCursor?: string }> {
    const [section, offsetStr] = (cursor ?? "a:0").split(":");
    const offset = parseInt(offsetStr, 10) || 0;

    if (section === "a") {
      const actors = (await foundryClient.getDocuments("actors", {
        requestedFields: ["_id", "name"],
      })) as Record<string, unknown>[];
      const page = actors.slice(offset, offset + PAGE_SIZE);
      const resources = page.map((a) => ({
        uri: `foundry://actors/${a._id}`,
        name: a.name as string,
        description: "Acteur Foundry (fiche complète JSON)",
        mimeType: "application/json",
      }));
      const nextCursor = offset + PAGE_SIZE < actors.length
        ? `a:${offset + PAGE_SIZE}`
        : "j:0";
      return { resources, nextCursor };
    }

    if (section === "j") {
      const journals = (await foundryClient.getDocuments("journal", {
        requestedFields: ["_id", "name"],
      })) as Record<string, unknown>[];
      const page = journals.slice(offset, offset + PAGE_SIZE);
      const resources = page.map((j) => ({
        uri: `foundry://journal/${j._id}`,
        name: j.name as string,
        description: "Journal Foundry (pages HTML)",
        mimeType: "text/html",
      }));
      const nextCursor = offset + PAGE_SIZE < journals.length
        ? `j:${offset + PAGE_SIZE}`
        : undefined;
      return { resources, ...(nextCursor ? { nextCursor } : {}) };
    }

    throw new Error(`Invalid cursor: ${cursor}`);
  }

  async function read(uri: string): Promise<{
    contents: Array<{ uri: string; mimeType: string; text: string }>;
  }> {
    const match = uri.match(/^foundry:\/\/(actors|journal)\/([A-Za-z0-9]+)$/);
    if (!match) {
      throw new Error(`Unknown resource URI: ${uri} (expected foundry://actors/<id> or foundry://journal/<id>)`);
    }
    const [, collection, _id] = match;

    const doc = await foundryClient.getDocument(collection, { _id }, {});
    if (!doc) {
      throw new Error(`Resource not found: ${uri}`);
    }

    if (collection === "actors") {
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(doc) }],
      };
    }

    // Journal : pages concaténées en HTML lisible.
    const pages = (doc.pages as Record<string, unknown>[] | undefined) ?? [];
    const html = [
      `<h1>${doc.name}</h1>`,
      ...pages.map((p) => {
        const content = ((p.text as Record<string, unknown> | undefined)?.content as string) ?? "";
        return `<h2>${p.name}</h2>\n${content}`;
      }),
    ].join("\n");
    const contents: Array<{ uri: string; mimeType: string; text: string }> = [
      { uri, mimeType: "text/html", text: html },
    ];

    // Fiche Campaign Codex : les données structurées en complément.
    const cc = (doc.flags as Record<string, unknown> | undefined)?.["campaign-codex"];
    if (cc) {
      contents.push({
        uri: `${uri}#campaign-codex`,
        mimeType: "application/json",
        text: JSON.stringify(cc),
      });
    }
    return { contents };
  }

  return { list, read };
}
