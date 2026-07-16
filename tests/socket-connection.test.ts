import {
  buildCompatSocketConnection,
  buildV13SocketConnection,
  buildV14SocketConnection,
  selectSocketConnection,
} from "../src/core/socket-connection.js";

describe("socket connection strategy", () => {
  test("v13 binds the session via the query parameter, no upgrade headers", () => {
    const conn = buildV13SocketConnection("example.com", "sid123");
    expect(conn.url).toBe("wss://example.com/socket.io/?session=sid123&EIO=4&transport=websocket");
    expect(conn.headers).toBeUndefined();
  });

  test("v14 binds the session via the cookie header, no session in query", () => {
    const conn = buildV14SocketConnection("example.com", "sid123");
    expect(conn.url).toBe("wss://example.com/socket.io/?EIO=4&transport=websocket");
    expect(conn.url).not.toContain("session=sid123");
    expect(conn.headers).toEqual({ Cookie: "session=sid123" });
  });

  test("compat sends both the query parameter and the cookie header", () => {
    const conn = buildCompatSocketConnection("example.com", "sid123");
    expect(conn.url).toBe("wss://example.com/socket.io/?session=sid123&EIO=4&transport=websocket");
    expect(conn.headers).toEqual({ Cookie: "session=sid123" });
  });

  describe("selectSocketConnection", () => {
    test("chooses the v14 (cookie) strategy for generation >= 14", () => {
      expect(selectSocketConnection(14, "h", "s")).toEqual(buildV14SocketConnection("h", "s"));
      expect(selectSocketConnection(15, "h", "s")).toEqual(buildV14SocketConnection("h", "s"));
    });

    test("chooses the v13 (query param) strategy for generation <= 13", () => {
      expect(selectSocketConnection(13, "h", "s")).toEqual(buildV13SocketConnection("h", "s"));
      expect(selectSocketConnection(11, "h", "s")).toEqual(buildV13SocketConnection("h", "s"));
    });

    test("falls back to the compat strategy when the generation is unknown", () => {
      expect(selectSocketConnection(null, "h", "s")).toEqual(buildCompatSocketConnection("h", "s"));
    });
  });
});
