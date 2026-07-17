import { EventEmitter } from "events";
import { FoundryClient } from "../src/foundry-client.js";
import type { FoundryCredential } from "../src/core/credentials.js";

class TestWebSocket extends EventEmitter {
  static OPEN = 1;
  url: string;
  readyState = TestWebSocket.OPEN;
  send = jest.fn();
  close = jest.fn(() => {
    this.readyState = 3;
  });

  constructor(url: string) {
    super();
    this.url = url;
  }
}

function createHttpsStub(responder: (req: EventEmitter, callback: (res: any) => void) => void) {
  return {
    request: jest.fn((options: any, callback: (res: any) => void) => {
      const req = new EventEmitter() as EventEmitter & { write: jest.Mock; end: jest.Mock };
      req.write = jest.fn();
      req.end = jest.fn(() => responder(req, callback));
      return req;
    }),
  };
}

function createClient(overrides: Record<string, unknown> = {}) {
  const logger = { error: jest.fn() };
  const wsLogger = { logInbound: jest.fn(), logOutbound: jest.fn(), close: jest.fn() } as any;
  const deps = {
    logger,
    wsLogger,
    ...overrides,
  };
  const client = new FoundryClient("/tmp/creds.json", deps as any);
  return { client, logger, wsLogger };
}

describe("FoundryClient", () => {
  test("loadCredentials parses config", () => {
    const creds = [
      { _id: "a", hostname: "h", password: "p", userid: "u" },
    ];
    const { client } = createClient({
      fs: { readFileSync: jest.fn(() => JSON.stringify(creds)) },
    });

    const loaded = (client as any).loadCredentials();
    expect(loaded).toEqual(creds);
  });

  test("loadCredentials wraps errors", () => {
    const { client } = createClient({
      fs: { readFileSync: jest.fn(() => { throw new Error("nope"); }) },
    });

    expect(() => (client as any).loadCredentials())
      .toThrow("Failed to load credentials");
  });

  test("getSession uses cookie when available", async () => {
    const https = createHttpsStub((_, callback) => {
      const res = new EventEmitter() as any;
      res.headers = { "set-cookie": ["session=abc123; Path=/"] };
      callback(res);
    });
    const { client } = createClient({ https });

    const sessionId = await (client as any).getSession("host");
    expect(sessionId).toBe("abc123");
  });

  test("getSession generates when no cookie", async () => {
    const https = createHttpsStub((_, callback) => {
      const res = new EventEmitter() as any;
      res.headers = {};
      callback(res);
    });
    const { client } = createClient({
      https,
      crypto: { randomBytes: jest.fn(() => Buffer.alloc(12, 1)) },
    });

    const sessionId = await (client as any).getSession("host");
    expect(sessionId).toBe(Buffer.alloc(12, 1).toString("hex"));
  });

  test("getSession rejects on request error", async () => {
    const https = {
      request: jest.fn((_options: any, _callback: any) => {
        const req = new EventEmitter() as EventEmitter & { end: jest.Mock };
        req.end = jest.fn(() => req.emit("error", new Error("fail")));
        return req;
      }),
    };
    const { client } = createClient({ https });

    await expect((client as any).getSession("host"))
      .rejects.toThrow("GET /join failed for host");
  });

  test("authenticate returns true on success", async () => {
    const https = createHttpsStub((req, callback) => {
      const res = new EventEmitter() as any;
      res.statusCode = 200;
      callback(res);
      res.emit("data", JSON.stringify({ status: "success", message: "ok" }));
      res.emit("end");
      expect((req as any).write).toHaveBeenCalled();
    });
    const { client } = createClient({ https });

    const success = await (client as any).authenticate("host", "sid", {
      _id: "x",
      hostname: "host",
      password: "pw",
      userid: "user",
    });
    expect(success).toBe(true);
  });

  test("authenticate returns false on failure", async () => {
    const https = createHttpsStub((_req, callback) => {
      const res = new EventEmitter() as any;
      res.statusCode = 401;
      callback(res);
      res.emit("data", "nope");
      res.emit("end");
    });
    const { client } = createClient({ https });

    const success = await (client as any).authenticate("host", "sid", {
      _id: "x",
      hostname: "host",
      password: "pw",
      userid: "user",
    });
    expect(success).toBe(false);
  });

  test("authenticate rejects on request error", async () => {
    const https = {
      request: jest.fn((_options: any, _callback: any) => {
        const req = new EventEmitter() as EventEmitter & { write: jest.Mock; end: jest.Mock };
        req.write = jest.fn();
        req.end = jest.fn(() => req.emit("error", new Error("fail")));
        return req;
      }),
    };
    const { client } = createClient({ https });

    await expect((client as any).authenticate("host", "sid", {
      _id: "x",
      hostname: "host",
      password: "pw",
      userid: "user",
    })).rejects.toThrow("POST /join failed for host");
  });

  test("connectWebSocket resolves on open", async () => {
    jest.useFakeTimers();
    let created: TestWebSocket | null = null;
    class Ws extends TestWebSocket {
      constructor(url: string) {
        super(url);
        created = this;
      }
    }

    const { client } = createClient({ WebSocketCtor: Ws });
    const promise = (client as any).connectWebSocket("host", "sid");
    created?.emit("open");
    await expect(promise).resolves.toBe(created);
    jest.useRealTimers();
  });

  test("connectWebSocket rejects on error", async () => {
    jest.useFakeTimers();
    let created: TestWebSocket | null = null;
    class Ws extends TestWebSocket {
      constructor(url: string) {
        super(url);
        created = this;
      }
    }

    const { client } = createClient({ WebSocketCtor: Ws });
    const promise = (client as any).connectWebSocket("host", "sid");
    created?.emit("error", new Error("boom"));
    await expect(promise).rejects.toThrow("WebSocket connection failed");
    jest.useRealTimers();
  });

  test("connectWebSocket times out", async () => {
    jest.useFakeTimers();
    class Ws extends TestWebSocket {}
    const { client } = createClient({ WebSocketCtor: Ws });

    const promise = (client as any).connectWebSocket("host", "sid");
    jest.advanceTimersByTime(10000);

    await expect(promise).rejects.toThrow("WebSocket connection timeout");
    jest.useRealTimers();
  });

  test("connectWebSocket binds the session via cookie header for Foundry v14", async () => {
    jest.useFakeTimers();
    let created: TestWebSocket | null = null;
    let ctorUrl = "";
    let ctorOpts: unknown = "unset";
    class Ws extends TestWebSocket {
      constructor(url: string, opts?: unknown) {
        super(url);
        created = this;
        ctorUrl = url;
        ctorOpts = opts;
      }
    }

    const { client } = createClient({ WebSocketCtor: Ws as any });
    const promise = (client as any).connectWebSocket("host", "sid", 14);
    created?.emit("open");

    await expect(promise).resolves.toBe(created);
    expect(ctorUrl).toBe("wss://host/socket.io/?EIO=4&transport=websocket");
    expect(ctorUrl).not.toContain("session=sid");
    expect(ctorOpts).toEqual({ headers: { Cookie: "session=sid" } });
    jest.useRealTimers();
  });

  test("connectWebSocket binds the session via query param for Foundry v13", async () => {
    jest.useFakeTimers();
    let created: TestWebSocket | null = null;
    let ctorUrl = "";
    let ctorOpts: unknown = "unset";
    class Ws extends TestWebSocket {
      constructor(url: string, opts?: unknown) {
        super(url);
        created = this;
        ctorUrl = url;
        ctorOpts = opts;
      }
    }

    const { client } = createClient({ WebSocketCtor: Ws as any });
    const promise = (client as any).connectWebSocket("host", "sid", 13);
    created?.emit("open");

    await expect(promise).resolves.toBe(created);
    expect(ctorUrl).toBe("wss://host/socket.io/?session=sid&EIO=4&transport=websocket");
    expect(ctorOpts).toBeUndefined();
    jest.useRealTimers();
  });

  test("detectGeneration parses the version from /api/status", async () => {
    const https = createHttpsStub((_req, callback) => {
      const res = new EventEmitter() as any;
      res.statusCode = 200;
      callback(res);
      res.emit("data", JSON.stringify({ active: true, version: "14.364" }));
      res.emit("end");
    });
    const { client } = createClient({ https });

    await expect((client as any).detectGeneration("host")).resolves.toBe(14);
    expect(https.request).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "host", path: "/api/status", method: "GET" }),
      expect.any(Function)
    );
  });

  test("detectGeneration returns null when the version cannot be determined", async () => {
    const https = createHttpsStub((_req, callback) => {
      const res = new EventEmitter() as any;
      res.statusCode = 200;
      callback(res);
      res.emit("data", "not json");
      res.emit("end");
    });
    const { client } = createClient({ https });

    await expect((client as any).detectGeneration("host")).resolves.toBeNull();
  });

  test("detectGeneration returns null on request error", async () => {
    const https = {
      request: jest.fn((_options: any, _callback: any) => {
        const req = new EventEmitter() as EventEmitter & { end: jest.Mock };
        req.end = jest.fn(() => req.emit("error", new Error("fail")));
        return req;
      }),
    };
    const { client } = createClient({ https });

    await expect((client as any).detectGeneration("host")).resolves.toBeNull();
  });

  test("waitForGameSession resolves when the session is bound", async () => {
    jest.useFakeTimers();
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");

    const promise = (client as any).waitForGameSession(ws);
    ws.emit("message", '42["session",{"sessionId":"abc","userId":"u1"}]');

    await expect(promise).resolves.toBeUndefined();
    jest.useRealTimers();
  });

  test("waitForGameSession rejects on a null session", async () => {
    jest.useFakeTimers();
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");

    const promise = (client as any).waitForGameSession(ws);
    ws.emit("message", '42["session",null]');

    await expect(promise).rejects.toThrow("null session");
    jest.useRealTimers();
  });

  test("waitForGameSession ignores unrelated messages then times out", async () => {
    jest.useFakeTimers();
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");

    const promise = (client as any).waitForGameSession(ws);
    ws.emit("message", '42["userActivity","u1",{}]');
    jest.advanceTimersByTime(10000);

    await expect(promise).rejects.toThrow("Timed out waiting for Foundry to bind the game session");
    jest.useRealTimers();
  });

  test("setupWebSocketHandlers responds to handshake", () => {
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).setupWebSocketHandlers(ws);

    ws.emit("message", "0{\"sid\":\"x\"}");

    expect(ws.send).toHaveBeenCalledWith("40");
  });

  test("setupWebSocketHandlers ignores session event", () => {
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).setupWebSocketHandlers(ws);

    ws.emit("message", "42[\"session\",{}]");

    expect(ws.send).not.toHaveBeenCalled();
  });

  test("setupWebSocketHandlers replies to Engine.IO ping with a pong", () => {
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).setupWebSocketHandlers(ws);

    ws.emit("message", "2");

    expect(ws.send).toHaveBeenCalledWith("3");
  });

  test("setupWebSocketHandlers triggers reconnect on close", () => {
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).connection = {
      hostname: "host",
      credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
      sessionId: "sid",
      ws,
    };

    const reconnect = jest.spyOn(client as any, "reconnect").mockResolvedValue(undefined);
    (client as any).setupWebSocketHandlers(ws);
    ws.emit("close", 1000, Buffer.from("bye"));

    expect(reconnect).toHaveBeenCalled();
  });

  test("reconnect handles success and fallbacks", async () => {
    // Backoff sleeps resolve immediately: the injected timer fires without delay.
    const immediateTimeout = ((cb: () => void) => {
      cb();
      return 0 as any;
    }) as typeof setTimeout;
    const { client } = createClient({ WebSocketCtor: TestWebSocket, setTimeoutFn: immediateTimeout });
    const ws = new TestWebSocket("ws://host");
    (client as any).connection = {
      hostname: "host",
      credential: { _id: "c", hostname: "host", password: "p", userid: "u" },
      sessionId: "sid",
      ws,
    };

    const authenticate = jest
      .spyOn(client as any, "authenticate")
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const getSession = jest
      .spyOn(client as any, "getSession")
      .mockResolvedValue("newSid");
    const connectWebSocket = jest
      .spyOn(client as any, "connectWebSocket")
      .mockResolvedValue(new TestWebSocket("ws://host"));
    jest.spyOn(client as any, "waitForGameSession").mockResolvedValue(undefined);

    await (client as any).reconnect();

    expect(authenticate).toHaveBeenCalledTimes(2);
    expect(getSession).toHaveBeenCalled();
    expect(connectWebSocket).toHaveBeenCalled();
  });

  test("connect throws when no credentials", async () => {
    const { client } = createClient({ fs: { readFileSync: jest.fn(() => "[]") } });
    await expect(client.connect()).rejects.toThrow("No credentials found in config file");
  });

  test("connect tries credentials until success", async () => {
    const creds = [
      { _id: "a", hostname: "a", password: "p", userid: "u" },
      { _id: "b", hostname: "b", password: "p", userid: "u" },
    ];
    const { client } = createClient({ fs: { readFileSync: jest.fn(() => JSON.stringify(creds)) } });

    jest.spyOn(client as any, "getSession").mockResolvedValue("sid");
    jest.spyOn(client as any, "authenticate")
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    jest.spyOn(client as any, "detectGeneration").mockResolvedValue(14);
    jest.spyOn(client as any, "connectWebSocket")
      .mockResolvedValue(new TestWebSocket("ws://b"));
    jest.spyOn(client as any, "setupWebSocketHandlers").mockImplementation(() => undefined);
    jest.spyOn(client as any, "waitForGameSession").mockResolvedValue(undefined);

    await client.connect();
    expect(client.getHostname()).toBe("b");
  });

  test("connect fails when all credentials fail", async () => {
    const creds = [{ _id: "a", hostname: "a", password: "p", userid: "u" }];
    const { client } = createClient({ fs: { readFileSync: jest.fn(() => JSON.stringify(creds)) } });

    jest.spyOn(client as any, "getSession").mockResolvedValue("sid");
    jest.spyOn(client as any, "authenticate").mockResolvedValue(false);

    await expect(client.connect()).rejects.toThrow("Failed to connect to any Foundry server");
  });

  test("chooseFoundryInstance switches connection", async () => {
    const creds = [
      { _id: "a", hostname: "a", password: "p", userid: "u" },
      { _id: "b", hostname: "b", password: "p", userid: "u" },
    ];
    const { client } = createClient({ fs: { readFileSync: jest.fn(() => JSON.stringify(creds)) } });

    const oldWs = new TestWebSocket("ws://a");
    (client as any).connection = {
      hostname: "a",
      credential: creds[0],
      sessionId: "sid",
      ws: oldWs,
    };

    jest.spyOn(client as any, "getSession").mockResolvedValue("sid");
    jest.spyOn(client as any, "authenticate").mockResolvedValue(true);
    jest.spyOn(client as any, "detectGeneration").mockResolvedValue(13);
    jest.spyOn(client as any, "connectWebSocket").mockResolvedValue(new TestWebSocket("ws://b"));
    jest.spyOn(client as any, "setupWebSocketHandlers").mockImplementation(() => undefined);
    jest.spyOn(client as any, "waitForGameSession").mockResolvedValue(undefined);

    await client.chooseFoundryInstance({ item_order: 1 });

    expect(oldWs.close).toHaveBeenCalled();
    expect(client.getHostname()).toBe("b");
  });

  test("getDocuments validates collection", async () => {
    const { client } = createClient();
    jest.spyOn(client, "requestWorldData").mockResolvedValue({});

    await expect(client.getDocuments("actors"))
      .rejects.toThrow("Response does not contain actors array");
  });

  test("getDocuments filters and truncates", async () => {
    const { client } = createClient();
    jest.spyOn(client, "requestWorldData").mockResolvedValue({
      actors: [
        { _id: "1", name: "A", type: "npc" },
        { _id: "2", name: "B", type: "pc" },
      ],
    });

    const docs = await client.getDocuments("actors", {
      requestedFields: ["type"],
      where: { type: "npc" },
      maxLength: 1000,
    });

    expect(docs).toEqual([{ _id: "1", name: "A", type: "npc" }]);
  });

  test("getDocument resolves by id and name", async () => {
    const { client } = createClient();
    jest.spyOn(client, "requestWorldData").mockResolvedValue({
      items: [
        { _id: "1", id: "1", name: "A" },
        { _id: "2", id: "2", name: "B" },
      ],
    });

    await expect(client.getDocument("items", { id: "1" }))
      .resolves.toEqual({ _id: "1", id: "1", name: "A" });
    await expect(client.getDocument("items", { _id: "2" }))
      .resolves.toEqual({ _id: "2", id: "2", name: "B" });
    await expect(client.getDocument("items", { name: "B" }))
      .resolves.toEqual({ _id: "2", id: "2", name: "B" });
  });

  test("getDocument returns null when missing", async () => {
    const { client } = createClient();
    jest.spyOn(client, "requestWorldData").mockResolvedValue({ items: [] });

    await expect(client.getDocument("items", { name: "Missing" }))
      .resolves.toBeNull();
  });

  describe("per-collection reads (socket get)", () => {
    test("getDocuments uses the socket get with pushdown query, no world dump", async () => {
      const { client } = createClient();
      const send = jest
        .spyOn(client as any, "sendModifyDocumentRequest")
        .mockResolvedValue({ action: "get", result: [{ _id: "1", name: "A", type: "npc" }] });
      const world = jest.spyOn(client, "requestWorldData");

      const docs = await client.getDocuments("actors", {
        where: { type: "npc", name__contains: "a" },
      });

      expect(send).toHaveBeenCalledWith(
        "Actor",
        "get",
        { query: { type: "npc" }, action: "get", broadcast: false, index: false },
        expect.any(String),
        expect.any(Function),
        "getCollection"
      );
      expect(world).not.toHaveBeenCalled();
      expect(docs).toEqual([{ _id: "1", name: "A", type: "npc" }]);
    });

    test("getDocument pushes _id (and id) into the query", async () => {
      const { client } = createClient();
      const send = jest
        .spyOn(client as any, "sendModifyDocumentRequest")
        .mockResolvedValue({ action: "get", result: [{ _id: "2", name: "B" }] });

      await expect(client.getDocument("items", { id: "2" }))
        .resolves.toEqual({ _id: "2", name: "B" });
      expect(send.mock.calls[0][2]).toMatchObject({ query: { _id: "2" } });

      await client.getDocument("items", { name: "B" });
      expect(send.mock.calls[1][2]).toMatchObject({ query: { name: "B" } });
    });

    test("falls back to the world dump when the socket get fails", async () => {
      const { client, logger } = createClient();
      jest
        .spyOn(client as any, "sendModifyDocumentRequest")
        .mockRejectedValue(new Error("boom"));
      jest.spyOn(client, "requestWorldData").mockResolvedValue({
        actors: [{ _id: "1", name: "A" }],
      });

      const docs = await client.getDocuments("actors");
      expect(docs).toEqual([{ _id: "1", name: "A" }]);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("falling back to world dump")
      );
    });

    test("unknown collection goes straight to the world dump", async () => {
      const { client } = createClient();
      const send = jest.spyOn(client as any, "sendModifyDocumentRequest");
      jest.spyOn(client, "requestWorldData").mockResolvedValue({
        weird: [{ _id: "1", name: "A" }],
      });

      const docs = await client.getDocuments("weird");
      expect(send).not.toHaveBeenCalled();
      expect(docs).toEqual([{ _id: "1", name: "A" }]);
    });

    test("retries with full documents when index entries are unusable", async () => {
      const { client, logger } = createClient();
      const send = jest
        .spyOn(client as any, "sendModifyDocumentRequest")
        .mockResolvedValueOnce({ action: "get", result: [{}, {}] }) // index vide (bug User v13)
        .mockResolvedValueOnce({ action: "get", result: [{ _id: "u1", name: "Edeker" }] });

      const docs = await client.getDocuments("users", { requestedFields: ["_id", "name"] });

      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[0][2]).toMatchObject({ index: true });
      expect(send.mock.calls[1][2]).toMatchObject({ index: false });
      expect(docs).toEqual([{ _id: "u1", name: "Edeker" }]);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("lack _id"));
    });

    test("keeps index results when they are usable", async () => {
      const { client } = createClient();
      const send = jest
        .spyOn(client as any, "sendModifyDocumentRequest")
        .mockResolvedValue({ action: "get", result: [{ _id: "j1", name: "Halyard" }] });

      const docs = await client.getDocuments("journal", { requestedFields: ["_id", "name"] });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][2]).toMatchObject({ index: true });
      expect(docs).toEqual([{ _id: "j1", name: "Halyard" }]);
    });

    test("event buffer records broadcasts and wakes waiters", async () => {
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host", credential: { _id: "c", hostname: "host", password: "p", userid: "u" },
        sessionId: "sid", ws, generation: 13,
      };
      jest.spyOn(client as any, "reconnect").mockResolvedValue(undefined);
      (client as any).setupWebSocketHandlers(ws);

      // broadcast d'un autre client : création de ChatMessage
      ws.emit("message", Buffer.from('42["modifyDocument",{"type":"ChatMessage","action":"create","result":[{"_id":"m1","content":"coucou"}]}]'));
      // événement ignoré
      ws.emit("message", Buffer.from('42["userActivity","u1",{}]'));
      // trame avec ackId (la nôtre) : PAS un broadcast
      ws.emit("message", Buffer.from('4212["modifyDocument",{}]'));

      const { lastSeq, events } = client.getEvents();
      expect(lastSeq).toBe(1);
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe("modifyDocument");

      // waiter sur événement futur
      const waiting = client.waitForEvent(
        (e) => (e.event === "pause" ? e.args[0] : undefined),
        5000,
        lastSeq
      );
      ws.emit("message", Buffer.from('42["pause",true,{"userId":"gm"}]'));
      await expect(waiting).resolves.toBe(true);

      // scan du buffer via sinceSeq (événement déjà passé)
      const past = await client.waitForEvent(
        (e) => (e.event === "modifyDocument" ? "found" : undefined),
        10,
        0
      );
      expect(past).toBe("found");
    });

    test("event buffer truncates oversized args", () => {
      const { client } = createClient();
      (client as any).recordEvent("modifyDocument", [{ big: "x".repeat(70_000) }]);
      const { events } = client.getEvents();
      expect(events[0].args[0]).toMatchObject({ truncated: true });
    });

    test("getSettings delegates to getDocuments('settings')", async () => {
      const { client } = createClient();
      const getDocs = jest.spyOn(client, "getDocuments").mockResolvedValue([{ _id: "s1", key: "core.x" } as any]);

      const docs = await client.getSettings({ where: { key: "core.x" } });
      expect(getDocs).toHaveBeenCalledWith("settings", { where: { key: "core.x" } });
      expect(docs).toEqual([{ _id: "s1", key: "core.x" }]);
    });

    test("searchJournals reads the journal collection via socket get", async () => {
      const { client } = createClient();
      const send = jest.spyOn(client as any, "sendModifyDocumentRequest").mockResolvedValue({
        action: "get",
        result: [
          {
            _id: "j1",
            name: "Notes",
            pages: [{ _id: "p1", name: "Page", text: { content: "<p>Jerserra attaque</p>" } }],
          },
        ],
      });
      const world = jest.spyOn(client, "requestWorldData");

      const hits = await client.searchJournals("jerserra");
      expect(send).toHaveBeenCalledWith(
        "JournalEntry",
        "get",
        expect.objectContaining({ query: {} }),
        expect.any(String),
        expect.any(Function),
        "getCollection"
      );
      expect(world).not.toHaveBeenCalled();
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ _id: "j1", match: "content" });
    });
  });

  test("modifyDocument builds operation", async () => {
    const { client } = createClient({ now: () => 123, WebSocketCtor: TestWebSocket });
    jest.spyOn(client as any, "sendModifyDocumentRequest")
      .mockResolvedValue({ ok: true });

    const result = await client.modifyDocument("Actor", "1", [{ name: "x" }], { parentUuid: "Scene.1" });

    expect(result).toEqual({ ok: true });
    expect((client as any).sendModifyDocumentRequest).toHaveBeenCalledWith(
      "Actor",
      "update",
      expect.objectContaining({ parentUuid: "Scene.1", modifiedTime: 123, pack: null }),
      expect.any(String),
      expect.any(Function),
      "modifyDocument"
    );
  });

  test("modifyDocument builds operation with pack", async () => {
    const { client } = createClient({ now: () => 123, WebSocketCtor: TestWebSocket });
    jest.spyOn(client as any, "sendModifyDocumentRequest")
      .mockResolvedValue({ ok: true });

    const result = await client.modifyDocument("Actor", "1", [{ name: "x" }], { pack: "world.my-compendium" });

    expect(result).toEqual({ ok: true });
    expect((client as any).sendModifyDocumentRequest).toHaveBeenCalledWith(
      "Actor",
      "update",
      expect.objectContaining({ modifiedTime: 123, pack: "world.my-compendium" }),
      expect.any(String),
      expect.any(Function),
      "modifyDocument"
    );
  });

  test("createDocument builds operation", async () => {
    const { client } = createClient({ now: () => 456, WebSocketCtor: TestWebSocket });
    jest.spyOn(client as any, "sendModifyDocumentRequest")
      .mockResolvedValue({ ok: true });

    await client.createDocument("Actor", [{ name: "x" }]);

    expect((client as any).sendModifyDocumentRequest).toHaveBeenCalledWith(
      "Actor",
      "create",
      expect.objectContaining({ modifiedTime: 456, pack: null }),
      expect.any(String),
      expect.any(Function),
      "createDocument"
    );
  });

  test("createDocument builds operation with pack", async () => {
    const { client } = createClient({ now: () => 456, WebSocketCtor: TestWebSocket });
    jest.spyOn(client as any, "sendModifyDocumentRequest")
      .mockResolvedValue({ ok: true });

    await client.createDocument("Actor", [{ name: "Goblin" }], { pack: "world.monsters" });

    expect((client as any).sendModifyDocumentRequest).toHaveBeenCalledWith(
      "Actor",
      "create",
      expect.objectContaining({ modifiedTime: 456, pack: "world.monsters" }),
      expect.any(String),
      expect.any(Function),
      "createDocument"
    );
  });

  test("deleteDocument builds operation", async () => {
    const { client } = createClient({ now: () => 789, WebSocketCtor: TestWebSocket });
    jest.spyOn(client as any, "sendModifyDocumentRequest")
      .mockResolvedValue({ ok: true });

    await client.deleteDocument("Actor", ["1"]);

    expect((client as any).sendModifyDocumentRequest).toHaveBeenCalledWith(
      "Actor",
      "delete",
      expect.objectContaining({ modifiedTime: 789, pack: null }),
      expect.any(String),
      expect.any(Function),
      "deleteDocument"
    );
  });

  test("deleteDocument builds operation with pack", async () => {
    const { client } = createClient({ now: () => 789, WebSocketCtor: TestWebSocket });
    jest.spyOn(client as any, "sendModifyDocumentRequest")
      .mockResolvedValue({ ok: true });

    await client.deleteDocument("Actor", ["abc123"], { pack: "world.monsters" });

    expect((client as any).sendModifyDocumentRequest).toHaveBeenCalledWith(
      "Actor",
      "delete",
      expect.objectContaining({ modifiedTime: 789, pack: "world.monsters" }),
      expect.any(String),
      expect.any(Function),
      "deleteDocument"
    );
  });

  test("requestWorldData resolves on world message", async () => {
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).connection = {
      hostname: "host",
      credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
      sessionId: "sid",
      ws,
    };

    const promise = client.requestWorldData();
    ws.emit("message", "430" + JSON.stringify([{ ok: true }]));

    await expect(promise).resolves.toEqual({ ok: true });
    expect(ws.send).toHaveBeenCalledWith('420["world"]');
  });

  test("requestWorldData rejects when not connected", async () => {
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    await expect(client.requestWorldData())
      .rejects.toThrow("Not connected to Foundry server");
  });

  test("requestWorldData rejects on parse error", async () => {
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).connection = {
      hostname: "host",
      credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
      sessionId: "sid",
      ws,
    };

    const promise = client.requestWorldData();
    ws.emit("message", "430not-json");

    await expect(promise).rejects.toThrow("Failed to parse world response");
  });

  test("sendModifyDocumentRequest resolves on match", async () => {
    jest.useFakeTimers();
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).connection = {
      hostname: "host",
      credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
      sessionId: "sid",
      ws,
    };

    const promise = (client as any).sendModifyDocumentRequest(
      "Actor",
      "update",
      { updates: [] },
      "timeout",
      (data: Record<string, unknown>) => data.action === "update",
      "modifyDocument"
    );

    ws.emit("message", "43" + JSON.stringify([{ type: "Actor", action: "update", result: [] }]));

    await expect(promise).resolves.toEqual({ type: "Actor", action: "update", result: [] });
    jest.useRealTimers();
  });

  test("sendModifyDocumentRequest ignores mismatched type and handles error payload", async () => {
    jest.useFakeTimers();
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).connection = {
      hostname: "host",
      credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
      sessionId: "sid",
      ws,
    };

    const promise = (client as any).sendModifyDocumentRequest(
      "Actor",
      "update",
      { updates: [] },
      "timeout",
      () => false,
      "modifyDocument"
    );

    ws.emit("message", "43" + JSON.stringify([{ type: "Other", action: "update", result: [] }]));
    ws.emit("message", "43" + JSON.stringify([{ type: "Actor", error: "bad" }]));

    await expect(promise).resolves.toEqual({ type: "Actor", error: "bad" });
    jest.useRealTimers();
  });

  test("sendModifyDocumentRequest times out", async () => {
    jest.useFakeTimers();
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).connection = {
      hostname: "host",
      credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
      sessionId: "sid",
      ws,
    };

    const promise = (client as any).sendModifyDocumentRequest(
      "Actor",
      "update",
      { updates: [] },
      "timeout",
      () => true,
      "modifyDocument"
    );

    jest.advanceTimersByTime(30000);
    await expect(promise).rejects.toThrow("timeout");
    jest.useRealTimers();
  });

  test("getWorld filters collections", async () => {
    const { client } = createClient();
    jest.spyOn(client, "requestWorldData").mockResolvedValue({ actors: [], meta: { title: "x" } });

    await expect(client.getWorld(["actors"]))
      .resolves.toEqual({ meta: { title: "x" } });
  });

  test("send throws when not connected", () => {
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    expect(() => client.send("hi")).toThrow("Not connected to Foundry server");
  });

  test("disconnect closes ws and logger", () => {
    const { client, wsLogger } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).connection = {
      hostname: "host",
      credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
      sessionId: "sid",
      ws,
    };

    client.disconnect();

    expect(ws.close).toHaveBeenCalled();
    expect(wsLogger.close).toHaveBeenCalled();
  });

  describe("uploadFile", () => {
    test("throws when both url and image_data provided", async () => {
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      await expect(client.uploadFile({
        target: "worlds/test/assets",
        filename: "test.png",
        url: "http://example.com/image.png",
        image_data: "base64data",
      })).rejects.toThrow("Cannot provide both 'url' and 'image_data'");
    });

    test("throws when neither url nor image_data provided", async () => {
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      await expect(client.uploadFile({
        target: "worlds/test/assets",
        filename: "test.png",
      })).rejects.toThrow("Must provide either 'url' or 'image_data'");
    });

    test("throws when not connected", async () => {
      const { client } = createClient({ WebSocketCtor: TestWebSocket });

      await expect(client.uploadFile({
        target: "worlds/test/assets",
        filename: "test.png",
        image_data: "aGVsbG8=",
      })).rejects.toThrow("Not connected to Foundry server");
    });

    test("uploads base64 image data successfully", async () => {
      const https = createHttpsStub((_req, callback) => {
        const res = new EventEmitter() as any;
        res.statusCode = 200;
        callback(res);
        res.emit("data", JSON.stringify({ path: "worlds/test/assets/test.png" }));
        res.emit("end");
      });

      const { client } = createClient({
        WebSocketCtor: TestWebSocket,
        https,
        crypto: { randomBytes: jest.fn(() => Buffer.alloc(8, 1)) },
      });

      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const result = await client.uploadFile({
        target: "worlds/test/assets",
        filename: "test.png",
        image_data: "aGVsbG8=", // "hello" in base64
      });

      expect(result.path).toBe("worlds/test/assets/test.png");
      expect(https.request).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: "host",
          path: "/upload",
          method: "POST",
        }),
        expect.any(Function)
      );
    });

    test("handles upload error response", async () => {
      const https = createHttpsStub((_req, callback) => {
        const res = new EventEmitter() as any;
        res.statusCode = 200;
        callback(res);
        res.emit("data", JSON.stringify({ error: "Permission denied" }));
        res.emit("end");
      });

      const { client } = createClient({
        WebSocketCtor: TestWebSocket,
        https,
        crypto: { randomBytes: jest.fn(() => Buffer.alloc(8, 1)) },
      });

      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      await expect(client.uploadFile({
        target: "worlds/test/assets",
        filename: "test.png",
        image_data: "aGVsbG8=",
      })).rejects.toThrow("Upload failed: Permission denied");
    });

    test("handles non-JSON success response", async () => {
      const https = createHttpsStub((_req, callback) => {
        const res = new EventEmitter() as any;
        res.statusCode = 200;
        callback(res);
        res.emit("data", "OK");
        res.emit("end");
      });

      const { client } = createClient({
        WebSocketCtor: TestWebSocket,
        https,
        crypto: { randomBytes: jest.fn(() => Buffer.alloc(8, 1)) },
      });

      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const result = await client.uploadFile({
        target: "worlds/test/assets",
        filename: "test.png",
        image_data: "aGVsbG8=",
      });

      expect(result.path).toBe("worlds/test/assets/test.png");
      expect(result.message).toBe("Upload completed");
    });

    test("rejects on request error", async () => {
      const https = {
        request: jest.fn((_options: any, _callback: any) => {
          const req = new EventEmitter() as EventEmitter & { write: jest.Mock; end: jest.Mock };
          req.write = jest.fn();
          req.end = jest.fn(() => req.emit("error", new Error("Network error")));
          return req;
        }),
      };

      const { client } = createClient({
        WebSocketCtor: TestWebSocket,
        https,
        crypto: { randomBytes: jest.fn(() => Buffer.alloc(8, 1)) },
      });

      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      await expect(client.uploadFile({
        target: "worlds/test/assets",
        filename: "test.png",
        image_data: "aGVsbG8=",
      })).rejects.toThrow("Upload request failed: Network error");
    });
  });

  describe("browseFiles", () => {
    test("throws when not connected", async () => {
      const { client } = createClient({ WebSocketCtor: TestWebSocket });

      await expect(client.browseFiles({
        target: "worlds/test/assets",
      })).rejects.toThrow("Not connected to Foundry server");
    });

    test("resolves on browse response", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.browseFiles({ target: "worlds/test/assets" });

      const response = {
        target: "worlds/test/assets",
        private: false,
        gridSize: null,
        dirs: ["worlds/test/assets/avatars"],
        privateDirs: [],
        files: ["worlds/test/assets/image.png"],
        extensions: [".png", ".jpg"],
      };

      ws.emit("message", "43" + JSON.stringify([response]));

      await expect(promise).resolves.toEqual(response);
      expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('["manageFiles"'));
      jest.useRealTimers();
    });

    test("uses default extensions for images", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      client.browseFiles({ target: "worlds/test/assets" });

      expect(ws.send).toHaveBeenCalledWith(
        expect.stringContaining('".apng"')
      );
      jest.useRealTimers();
    });

    test("uses custom type and extensions", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      client.browseFiles({
        target: "worlds/test/assets",
        type: "audio",
        extensions: [".mp3", ".wav"],
      });

      const sentMessage = ws.send.mock.calls[0][0];
      expect(sentMessage).toContain('"type":"audio"');
      expect(sentMessage).toContain('".mp3"');
      expect(sentMessage).toContain('".wav"');
      jest.useRealTimers();
    });

    test("rejects on error response with dirs", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.browseFiles({ target: "worlds/test/assets" });

      ws.emit("message", "43" + JSON.stringify([{
        dirs: [],
        error: "Directory not found",
      }]));

      await expect(promise).rejects.toThrow("Browse files failed: Directory not found");
      jest.useRealTimers();
    });

    test("rejects on error response without dirs (non-existent directory)", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.browseFiles({ target: "worlds/werewolf-the-forsaken" });

      // Foundry returns error-only response when directory doesn't exist
      ws.emit("message", "431" + JSON.stringify([{
        error: "Directory worlds/werewolf-the-forsaken does not exist or is not accessible in this storage location",
      }]));

      await expect(promise).rejects.toThrow("Browse files failed: Directory worlds/werewolf-the-forsaken does not exist");
      jest.useRealTimers();
    });

    test("times out after 30 seconds", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.browseFiles({ target: "worlds/test/assets" });

      jest.advanceTimersByTime(30000);

      await expect(promise).rejects.toThrow("Timeout waiting for browseFiles response");
      jest.useRealTimers();
    });

    test("ignores unrelated messages", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.browseFiles({ target: "worlds/test/assets" });

      // Send unrelated message (no dirs)
      ws.emit("message", "43" + JSON.stringify([{ type: "Actor", result: [] }]));

      // Then send the actual response
      const response = {
        target: "worlds/test/assets",
        private: false,
        gridSize: null,
        dirs: [],
        privateDirs: [],
        files: [],
        extensions: [],
      };
      ws.emit("message", "43" + JSON.stringify([response]));

      await expect(promise).resolves.toEqual(response);
      jest.useRealTimers();
    });
  });

  describe("createCompendium", () => {
    test("throws when not connected", async () => {
      const { client } = createClient({ WebSocketCtor: TestWebSocket });

      await expect(client.createCompendium("My NPCs", "Actor"))
        .rejects.toThrow("Not connected to Foundry server");
    });

    test("sends correct payload", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      client.createCompendium("My NPCs", "Actor");

      const sentMessage = ws.send.mock.calls[0][0];
      expect(sentMessage).toContain('"manageCompendium"');
      expect(sentMessage).toContain('"action":"create"');
      expect(sentMessage).toContain('"label":"My NPCs"');
      expect(sentMessage).toContain('"type":"Actor"');
      jest.useRealTimers();
    });

    test("resolves on success response", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.createCompendium("My NPCs", "Actor");

      const response = {
        request: {
          action: "create",
          data: {
            label: "My NPCs",
            type: "Actor",
            name: "my-npcs",
            id: "world.my-npcs",
          },
        },
        result: {
          label: "My NPCs",
          type: "Actor",
          name: "my-npcs",
          id: "world.my-npcs",
        },
      };

      ws.emit("message", "43" + JSON.stringify([response]));

      await expect(promise).resolves.toEqual(response);
      jest.useRealTimers();
    });

    test("rejects on error response", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.createCompendium("My NPCs", "Actor");

      const response = {
        request: { action: "create" },
        error: "Permission denied",
      };

      ws.emit("message", "43" + JSON.stringify([response]));

      await expect(promise).rejects.toThrow("Create compendium failed: Permission denied");
      jest.useRealTimers();
    });

    test("times out after 30 seconds", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.createCompendium("My NPCs", "Actor");

      jest.advanceTimersByTime(30000);

      await expect(promise).rejects.toThrow("Timeout waiting for createCompendium response");
      jest.useRealTimers();
    });

    test("ignores unrelated messages", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.createCompendium("My NPCs", "Actor");

      // Send unrelated message (wrong action)
      ws.emit("message", "43" + JSON.stringify([{ request: { action: "delete" }, result: "ok" }]));

      // Send correct response
      const response = {
        request: { action: "create" },
        result: { label: "My NPCs", name: "my-npcs" },
      };
      ws.emit("message", "43" + JSON.stringify([response]));

      await expect(promise).resolves.toEqual(response);
      jest.useRealTimers();
    });
  });

  describe("deleteCompendium", () => {
    test("throws when not connected", async () => {
      const { client } = createClient({ WebSocketCtor: TestWebSocket });

      await expect(client.deleteCompendium("my-npcs"))
        .rejects.toThrow("Not connected to Foundry server");
    });

    test("sends correct payload", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      client.deleteCompendium("my-npcs");

      const sentMessage = ws.send.mock.calls[0][0];
      expect(sentMessage).toContain('"manageCompendium"');
      expect(sentMessage).toContain('"action":"delete"');
      expect(sentMessage).toContain('"data":"my-npcs"');
      jest.useRealTimers();
    });

    test("resolves on success response", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.deleteCompendium("my-npcs");

      const response = {
        request: { action: "delete", data: "my-npcs" },
        result: "world.my-npcs",
      };

      ws.emit("message", "43" + JSON.stringify([response]));

      await expect(promise).resolves.toEqual(response);
      jest.useRealTimers();
    });

    test("rejects on error response", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.deleteCompendium("nonexistent");

      const response = {
        request: { action: "delete" },
        error: "Compendium not found",
      };

      ws.emit("message", "43" + JSON.stringify([response]));

      await expect(promise).rejects.toThrow("Delete compendium failed: Compendium not found");
      jest.useRealTimers();
    });

    test("times out after 30 seconds", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.deleteCompendium("my-npcs");

      jest.advanceTimersByTime(30000);

      await expect(promise).rejects.toThrow("Timeout waiting for deleteCompendium response");
      jest.useRealTimers();
    });

    test("ignores unrelated messages", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.deleteCompendium("my-npcs");

      // Send unrelated message (wrong action)
      ws.emit("message", "43" + JSON.stringify([{ request: { action: "create" }, result: {} }]));

      // Send correct response
      const response = {
        request: { action: "delete" },
        result: "world.my-npcs",
      };
      ws.emit("message", "43" + JSON.stringify([response]));

      await expect(promise).resolves.toEqual(response);
      jest.useRealTimers();
    });
  });

  describe("getContentTypeFromFilename", () => {
    test("returns correct mime types", () => {
      const { client } = createClient();
      const getContentType = (client as any).getContentTypeFromFilename.bind(client);

      expect(getContentType("image.png")).toBe("image/png");
      expect(getContentType("photo.jpg")).toBe("image/jpeg");
      expect(getContentType("photo.jpeg")).toBe("image/jpeg");
      expect(getContentType("animation.gif")).toBe("image/gif");
      expect(getContentType("icon.svg")).toBe("image/svg+xml");
      expect(getContentType("doc.pdf")).toBe("application/pdf");
      expect(getContentType("song.mp3")).toBe("audio/mpeg");
      expect(getContentType("unknown.xyz")).toBe("application/octet-stream");
    });
  });

  describe("buildMultipartFormData", () => {
    test("builds correct multipart structure", () => {
      const { client } = createClient();
      const buildFormData = (client as any).buildMultipartFormData.bind(client);

      const result = buildFormData("----TestBoundary", {
        source: "data",
        target: "worlds/test",
        filename: "test.png",
        fileBuffer: Buffer.from("test"),
        contentType: "image/png",
      });

      const str = result.toString();
      expect(str).toContain("------TestBoundary");
      expect(str).toContain('name="source"');
      expect(str).toContain("data");
      expect(str).toContain('name="target"');
      expect(str).toContain("worlds/test");
      expect(str).toContain('name="upload"');
      expect(str).toContain('filename="test.png"');
      expect(str).toContain("Content-Type: image/png");
      expect(str).toContain('name="bucket"');
      expect(str).toContain("null");
      expect(str).toContain("------TestBoundary--");
    });
  });
});
