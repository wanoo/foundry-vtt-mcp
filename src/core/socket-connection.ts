// socket-connection.ts
// Builds the WebSocket connection parameters (URL + upgrade headers) for a
// Foundry socket.io connection. The message shapes are identical across
// Foundry v13 and v14 — the ONLY thing that differs between versions is how the
// authenticated session is bound during the socket.io upgrade:
//
//   v13 (<= gen 13): session travels in the `?session=` query parameter.
//   v14 (>= gen 14): session travels in the `session` cookie on the upgrade
//                    request; the query parameter is ignored.
//
// This was verified empirically against live servers and confirmed by reading
// Foundry's own client `Game.connect()` in both generations.

import { usesCookieSessionBinding } from "./version.js";

export interface SocketConnection {
  url: string;
  /** Extra HTTP headers to send on the WebSocket upgrade request, if any. */
  headers?: Record<string, string>;
}

const SOCKET_IO_TRANSPORT = "EIO=4&transport=websocket";

/**
 * Foundry <= v13 connection: bind the session via the `?session=` query
 * parameter (this is what Foundry's own v13 client does).
 */
export function buildV13SocketConnection(hostname: string, sessionId: string): SocketConnection {
  return {
    url: `wss://${hostname}/socket.io/?session=${sessionId}&${SOCKET_IO_TRANSPORT}`,
  };
}

/**
 * Foundry >= v14 connection: bind the session via the `session` cookie on the
 * upgrade request. The query parameter is omitted because v14 ignores it.
 */
export function buildV14SocketConnection(hostname: string, sessionId: string): SocketConnection {
  return {
    url: `wss://${hostname}/socket.io/?${SOCKET_IO_TRANSPORT}`,
    headers: { Cookie: `session=${sessionId}` },
  };
}

/**
 * Fallback used when the generation is unknown: satisfy BOTH binding mechanisms
 * at once (query parameter and cookie header). Verified safe on both v13 and
 * v14 — each version reads only the form it understands and ignores the other.
 */
export function buildCompatSocketConnection(hostname: string, sessionId: string): SocketConnection {
  return {
    url: `wss://${hostname}/socket.io/?session=${sessionId}&${SOCKET_IO_TRANSPORT}`,
    headers: { Cookie: `session=${sessionId}` },
  };
}

/**
 * Select the correct connection strategy for a detected Foundry generation.
 * A null generation means detection failed, so we use the compat strategy.
 */
export function selectSocketConnection(
  generation: number | null,
  hostname: string,
  sessionId: string
): SocketConnection {
  if (generation === null) {
    return buildCompatSocketConnection(hostname, sessionId);
  }
  return usesCookieSessionBinding(generation)
    ? buildV14SocketConnection(hostname, sessionId)
    : buildV13SocketConnection(hostname, sessionId);
}
