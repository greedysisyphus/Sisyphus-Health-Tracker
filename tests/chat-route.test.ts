import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyIdToken, store, afterTasks } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  store: new Map<string, Record<string, unknown>>(),
  afterTasks: [] as Array<() => unknown>,
}));

vi.mock("next/server", () => ({ after: (task: () => unknown) => { afterTasks.push(task); } }));
vi.mock("../lib/firebase-admin-auth", () => ({ getAdminAuth: () => ({ verifyIdToken }) }));
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "SERVER_TIME" } }));
vi.mock("../lib/firebase-admin", () => ({
  getAdminDb: () => ({
    collection: (path: string) => ({
      doc: (id: string) => {
        const key = `${path}/${id}`;
        return {
          get: async () => ({ exists: store.has(key), data: () => store.get(key) }),
          set: async (value: Record<string, unknown>) => { store.set(key, { ...value }); },
          update: async (value: Record<string, unknown>) => { store.set(key, { ...store.get(key), ...value }); },
        };
      },
      where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
    }),
    doc: (path: string) => ({ get: async () => ({ exists: store.has(path), data: () => store.get(path) }) }),
  }),
}));

import { GET, POST } from "../app/api/chat/route";
import { resolveChatTarget, runInstructions, runRequestBody } from "../lib/chat-hermes";

const WIFE = "wife-uid";
const OWNER = "owner-uid";
const CHAT_KEY = "k".repeat(64);
const photo = `data:image/jpeg;base64,${"A".repeat(200)}`;
const thumb = `data:image/jpeg;base64,${"B".repeat(40)}`;

function send(body: unknown, token = "token") {
  return POST(new Request("https://example.com/api/chat", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

const hermes = vi.fn();

describe("dashboard chat route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    store.clear();
    afterTasks.length = 0;
    process.env.HEALTH_TRACKER_OWNER_ID = OWNER;
    process.env.HEALTH_TRACKER_SECONDARY_OWNER_ID = WIFE;
    process.env.HERMES_SECONDARY_CHAT_URL = "https://hermes.example/p/health-wife";
    process.env.HERMES_SECONDARY_CHAT_KEY = CHAT_KEY;
    delete process.env.HERMES_CHAT_URL;
    delete process.env.HERMES_CHAT_KEY;
    verifyIdToken.mockResolvedValue({ uid: WIFE });
    process.env.CHAT_RETRY_DELAYS_MS = "0,0";
    hermes.mockResolvedValue(new Response(JSON.stringify({ run_id: "run_1", status: "started" }), { status: 202 }));
    vi.stubGlobal("fetch", hermes);
  });

  it("requires a signed-in user", async () => {
    expect((await send({ id: "msg_00000001", text: "hi" }, "")).status).toBe(401);
    verifyIdToken.mockRejectedValueOnce(new Error("bad token"));
    expect((await send({ id: "msg_00000001", text: "hi" })).status).toBe(401);
    expect(hermes).not.toHaveBeenCalled();
  });

  it("refuses users who have no Hermes chat configured, including the owner by default", async () => {
    verifyIdToken.mockResolvedValueOnce({ uid: "stranger" });
    expect((await send({ id: "msg_00000001", text: "hi" })).status).toBe(403);
    verifyIdToken.mockResolvedValueOnce({ uid: OWNER });
    expect((await send({ id: "msg_00000001", text: "hi" })).status).toBe(403);
    expect(hermes).not.toHaveBeenCalled();
  });

  it("rejects empty messages, non-JPEG photos, and mismatched thumbnails", async () => {
    expect((await send({ id: "msg_00000001", text: "  " })).status).toBe(400);
    expect((await send({ id: "msg_00000001", photos: ["data:image/png;base64,AAAA"], thumbs: [thumb] })).status).toBe(400);
    expect((await send({ id: "msg_00000001", photos: [photo, photo], thumbs: [thumb] })).status).toBe(400);
    expect((await send({ id: "bad id!", text: "hi" })).status).toBe(400);
    expect(hermes).not.toHaveBeenCalled();
  });

  it("starts one Hermes run per message with every photo, the message id as eventId, and answers before the run ends", async () => {
    const response = await send({ id: "msg_00000001", text: "午餐", photos: [photo, photo, photo], thumbs: [thumb, thumb, thumb] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, status: "processing" });
    expect(hermes).toHaveBeenCalledOnce();
    const [url, init] = hermes.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hermes.example/p/health-wife/v1/runs");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${CHAT_KEY}`);
    expect(headers["Idempotency-Key"]).toBe("dashboard-chat-msg_00000001");
    const body = JSON.parse(String(init.body));
    expect(body.input[0].content.filter((part: { type: string }) => part.type === "input_image")).toHaveLength(3);
    expect(body.instructions).toContain('eventId 用 "msg_00000001"');
    expect(body.instructions).toContain('source 用 "dashboard"');
    // Never the bare date: two profiles sharing a session id leaked one person's chat into the other's.
    expect(body.session_id).toMatch(/^dashboard-secondary-\d{4}-\d{2}-\d{2}$/);
    const saved = store.get(`users/${WIFE}/chatMessages/msg_00000001`);
    expect(saved).toMatchObject({ status: "processing", runId: "run_1", photoCount: 3, thumbs: [thumb, thumb, thumb] });
    expect(saved).not.toHaveProperty("photos");
    expect(afterTasks).toHaveLength(1);
  });

  it("does not start a second run when the phone resends a message that was already admitted", async () => {
    await send({ id: "msg_00000001", text: "水 500" });
    const again = await send({ id: "msg_00000001", text: "水 500" });
    expect(again.status).toBe(200);
    expect(hermes).toHaveBeenCalledOnce();
  });

  it("tells the phone to keep the message when Hermes stays unreachable, then accepts the retry", async () => {
    const down = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    hermes.mockRejectedValueOnce(down).mockRejectedValueOnce(down).mockRejectedValueOnce(down);
    expect((await send({ id: "msg_00000001", text: "水 500" })).status).toBe(503);
    expect(store.get(`users/${WIFE}/chatMessages/msg_00000001`)).toMatchObject({ status: "retry", error: "fetch failed (ECONNRESET)" });
    expect((await send({ id: "msg_00000001", text: "水 500" })).status).toBe(200);
    expect(hermes).toHaveBeenCalledTimes(4);
    expect(store.get(`users/${WIFE}/chatMessages/msg_00000001`)).toMatchObject({ status: "processing", runId: "run_1" });
  });

  it("resends a byte-identical Hermes request when the retry comes minutes later", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-18T10:00:00Z"));
      hermes.mockRejectedValueOnce(new Error("response lost")).mockRejectedValueOnce(new Error("response lost")).mockRejectedValueOnce(new Error("response lost"));
      expect((await send({ id: "msg_00000002", text: "晚餐" })).status).toBe(503);
      vi.setSystemTime(new Date("2026-11-18T16:30:00Z")); // next day in Taipei
      expect((await send({ id: "msg_00000002", text: "晚餐" })).status).toBe(200);
      const [first, second] = hermes.mock.calls.map(call => (call[1] as RequestInit).body);
      expect(second).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-attempts a message whose first attempt died before Hermes was reached", async () => {
    store.set(`users/${WIFE}/chatMessages/msg_00000003`, { status: "sending", attemptAt: Date.now() });
    expect((await send({ id: "msg_00000003", text: "水 300" })).status).toBe(200);
    expect(hermes).toHaveBeenCalledOnce();
    expect(store.get(`users/${WIFE}/chatMessages/msg_00000003`)).toMatchObject({ status: "processing" });
  });

  it("tells Eris what this person does not track, and keeps that wording on retries", async () => {
    store.set(`users/${WIFE}`, { tracking: { water: false, weight: true, steps: false }, healthFocus: "減脂・多吃蛋白質" });
    hermes.mockRejectedValueOnce(new Error("response lost")).mockRejectedValueOnce(new Error("response lost")).mockRejectedValueOnce(new Error("response lost"));
    expect((await send({ id: "msg_00000004", text: "奶茶一杯" })).status).toBe(503);
    store.set(`users/${WIFE}`, { tracking: { water: true, weight: true, steps: true } });
    expect((await send({ id: "msg_00000004", text: "奶茶一杯" })).status).toBe(200);
    const [first, second] = hermes.mock.calls.map(call => JSON.parse(String((call[1] as RequestInit).body)).instructions as string);
    expect(first).toContain("不記錄喝水");
    expect(first).toContain("不記錄步數");
    expect(first).not.toContain("不記錄體重");
    expect(first).toContain("減脂・多吃蛋白質");
    expect(second).toBe(first);
  });

  it("adds no tracking lines for an account that never changed the defaults", async () => {
    await send({ id: "msg_00000005", text: "早餐" });
    const instructions = JSON.parse(String((hermes.mock.calls[0][1] as RequestInit).body)).instructions as string;
    expect(instructions).not.toContain("不記錄");
  });

  it("accepts detailed photo thumbnails and explains a rejection", async () => {
    const bigThumb = `data:image/jpeg;base64,${"C".repeat(60_000)}`;
    expect((await send({ id: "msg_00000006", photos: [photo], thumbs: [bigThumb] })).status).toBe(200);
    const tooMany = await send({ id: "msg_00000007", photos: Array(10).fill(photo), thumbs: Array(10).fill(`data:image/jpeg;base64,${"D".repeat(100_000)}`) });
    expect(tooMany.status).toBe(400);
    expect((await tooMany.json()).reasons).toContain("thumbs_too_large");
  });

  it("rides out a dropped connection within one send, reaching the same run", async () => {
    hermes.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await send({ id: "msg_00000008", text: "體重 54" })).status).toBe(200);
    expect(hermes).toHaveBeenCalledTimes(2);
    const [first, second] = hermes.mock.calls.map(call => call[1] as RequestInit);
    expect(second.body).toBe(first.body);
    expect((second.headers as Record<string, string>)["Idempotency-Key"]).toBe((first.headers as Record<string, string>)["Idempotency-Key"]);
  });

  it("does not retry when Hermes answers with a refusal", async () => {
    hermes.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "gateway_auth_failed" } }), { status: 401 }));
    expect((await send({ id: "msg_00000009", text: "水" })).status).toBe(503);
    expect(hermes).toHaveBeenCalledOnce();
    expect(store.get(`users/${WIFE}/chatMessages/msg_00000009`)).toMatchObject({ error: "hermes_run_rejected:401:gateway_auth_failed" });
  });

  it("reports whether chat is enabled for the signed-in user", async () => {
    const enabled = await GET(new Request("https://example.com/api/chat", { headers: { Authorization: "Bearer token" } }));
    expect(await enabled.json()).toMatchObject({ enabled: true });
    verifyIdToken.mockResolvedValueOnce({ uid: "stranger" });
    const disabled = await GET(new Request("https://example.com/api/chat", { headers: { Authorization: "Bearer token" } }));
    expect(await disabled.json()).toEqual({ enabled: false });
  });
});

describe("chat target resolution", () => {
  it("maps only a configured uid to its own Hermes endpoint and rejects weak or insecure settings", () => {
    const env = { HEALTH_TRACKER_SECONDARY_OWNER_ID: WIFE, HERMES_SECONDARY_CHAT_URL: "https://h.example/p/w/", HERMES_SECONDARY_CHAT_KEY: CHAT_KEY } as unknown as NodeJS.ProcessEnv;
    expect(resolveChatTarget(WIFE, env)).toEqual({ url: "https://h.example/p/w", key: CHAT_KEY, session: "secondary" });
    expect(resolveChatTarget(OWNER, env)).toBeNull();
    expect(resolveChatTarget(WIFE, { ...env, HERMES_SECONDARY_CHAT_KEY: "short" })).toBeNull();
    expect(resolveChatTarget(WIFE, { ...env, HERMES_SECONDARY_CHAT_URL: "http://h.example/p/w" })).toBeNull();
  });

  it("gives each person a different Hermes session on the same day", () => {
    const message = { id: "msg_00000001", text: "hi", photos: [], thumbs: [] };
    const now = new Date("2026-11-18T12:00:00Z");
    expect(runRequestBody(message, "owner", now).session_id).toBe("dashboard-owner-2026-11-18");
    expect(runRequestBody(message, "secondary", now).session_id).toBe("dashboard-secondary-2026-11-18");
  });

  it("dates the instructions in Asia/Taipei", () => {
    expect(runInstructions("m1", new Date("2026-11-18T16:30:00Z"))).toContain("2026-11-19 00:30");
  });
});
