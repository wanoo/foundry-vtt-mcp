export function filterDocumentFields(
  doc: Record<string, unknown>,
  requestedFields: string[] | null
): Record<string, unknown> {
  if (!requestedFields || requestedFields.length === 0) {
    return doc;
  }

  const fieldsToInclude = new Set(requestedFields);
  fieldsToInclude.add("_id");
  fieldsToInclude.add("name");

  const filtered: Record<string, unknown> = {};
  for (const field of fieldsToInclude) {
    if (field in doc) {
      filtered[field] = doc[field];
    }
  }
  return filtered;
}

export function truncateDocuments(
  docs: Record<string, unknown>[],
  maxLength: number
): Record<string, unknown>[] {
  if (!maxLength || maxLength <= 0) {
    return docs;
  }

  const result = [...docs];
  while (result.length > 0) {
    const json = JSON.stringify(result);
    if (Buffer.byteLength(json, "utf-8") <= maxLength) {
      return result;
    }
    result.pop();
  }
  return result;
}

/**
 * Resolve a dotted path ("flags.campaign-codex.type") in a nested object.
 * Returns undefined as soon as a segment is missing.
 */
export function getPath(doc: unknown, path: string): unknown {
  let current: unknown = doc;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Where filter with dotted paths and operator suffixes (AND logic):
 *   { "name": "Riar" }                              → strict equality
 *   { "flags.campaign-codex.type": "npc" }          → nested path
 *   { "_id__in": ["a", "b"] }                       → membership
 *   { "name__contains": "riar" }                    → case-insensitive substring
 *                                                     (or array membership)
 *   { "folder__ne": null }                          → inequality
 *   { "flags.core__exists": true }                  → key presence
 */
export function filterDocumentsByWhere(
  docs: Record<string, unknown>[],
  where: Record<string, unknown> | null
): Record<string, unknown>[] {
  if (!where || Object.keys(where).length === 0) {
    return docs;
  }

  const conditions = Object.entries(where).map(([key, value]) => {
    const match = key.match(/^(.*)__(in|contains|ne|exists)$/);
    return {
      path: match ? match[1] : key,
      op: match ? match[2] : "eq",
      value,
    };
  });

  return docs.filter((doc) => {
    for (const { path, op, value } of conditions) {
      const actual = getPath(doc, path);
      switch (op) {
        case "eq":
          if (actual !== value) return false;
          break;
        case "ne":
          if (actual === value) return false;
          break;
        case "in":
          if (!Array.isArray(value) || !value.includes(actual)) return false;
          break;
        case "contains":
          if (typeof actual === "string" && typeof value === "string") {
            if (!actual.toLowerCase().includes(value.toLowerCase())) return false;
          } else if (Array.isArray(actual)) {
            if (!actual.includes(value)) return false;
          } else {
            return false;
          }
          break;
        case "exists":
          if ((actual !== undefined) !== Boolean(value)) return false;
          break;
      }
    }
    return true;
  });
}
