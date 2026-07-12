// version.ts
// Foundry VTT major-generation detection.
//
// The generation determines how the WebSocket session is bound during the
// socket.io upgrade (see socket-connection.ts):
//   - generation <= 13: the client passes the session in the `?session=` query
//     parameter (Foundry's own v13 client: `query: {session: sessionId}`).
//   - generation >= 14: the query parameter was removed; the session is bound
//     purely from the `session` cookie on the HTTP upgrade request
//     (Foundry's own v14 client: `io.connect({ ..., cookie: false })` with no query).

/** First generation that binds the socket session via the upgrade-request cookie. */
export const FOUNDRY_COOKIE_BINDING_GENERATION = 14;

/**
 * Parse the leading integer "generation" from a Foundry version string.
 * "14.364" -> 14, "13.347" -> 13, "9.280" -> 9, "0.8.9" -> 0 (pre-v9 legacy).
 */
export function parseGenerationFromVersion(version: string): number | null {
  const match = version.trim().match(/^(\d+)/);
  if (!match) {
    return null;
  }
  const gen = parseInt(match[1], 10);
  return Number.isFinite(gen) ? gen : null;
}

/**
 * Parse the Foundry generation from the body of a `GET /api/status` response.
 * Prefers an explicit numeric `release.generation`, then falls back to the
 * `version` string. Returns null when the body cannot be interpreted.
 */
export function parseFoundryGeneration(statusBody: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(statusBody);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const status = parsed as { version?: unknown; release?: { generation?: unknown } };

  const generation = status.release?.generation;
  if (typeof generation === "number" && Number.isInteger(generation) && generation > 0) {
    return generation;
  }

  if (typeof status.version === "string") {
    return parseGenerationFromVersion(status.version);
  }

  if (typeof status.version === "number" && Number.isFinite(status.version)) {
    return Math.floor(status.version);
  }

  return null;
}

/**
 * Whether the given generation binds the socket session via the upgrade-request
 * cookie (v14+) rather than the `?session=` query parameter (<= v13).
 */
export function usesCookieSessionBinding(generation: number | null): boolean {
  return generation !== null && generation >= FOUNDRY_COOKIE_BINDING_GENERATION;
}
