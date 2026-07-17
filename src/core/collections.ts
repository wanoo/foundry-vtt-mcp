// collections.ts
// Maps world-collection names (as exposed by the MCP tools and the world dump)
// to Foundry document types (as expected by the socket "modifyDocument" event).
export const COLLECTION_TO_TYPE: Record<string, string> = {
  actors: "Actor",
  items: "Item",
  folders: "Folder",
  users: "User",
  scenes: "Scene",
  journal: "JournalEntry",
  macros: "Macro",
  cards: "Cards",
  playlists: "Playlist",
  tables: "RollTable",
  combats: "Combat",
  messages: "ChatMessage",
  settings: "Setting",
};

/**
 * Extract the server-side pushdown query from a `where` filter: plain top-level
 * equality entries (no `__` operator suffix, no dotted path) plus `_id__in`
 * (supported by Foundry's database "get" queries). The full `where` must still
 * be re-applied client-side — the pushdown only shrinks the payload.
 */
export function extractPushdownQuery(
  where: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  if (!where) {
    return query;
  }
  for (const [key, value] of Object.entries(where)) {
    if (key === "_id__in" && Array.isArray(value)) {
      query[key] = value;
    } else if (!key.includes(".") && !/__(in|contains|ne|exists)$/.test(key)) {
      query[key] = value;
    }
  }
  return query;
}
