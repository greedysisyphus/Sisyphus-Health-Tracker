import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAdminDb } = vi.hoisted(() => ({ getAdminDb: vi.fn() }));

vi.mock("../lib/firebase-admin", () => ({ getAdminDb }));

import { POST } from "../app/api/health/import/route";

const originalEnv = { ...process.env };
const validPayload = {
  date: "2026-08-29",
  steps: 5234,
  source: "apple_health",
  syncedAt: "2026-08-29T15:35:00+08:00",
};

function request(body: unknown, token = "health-import-secret") {
  return new Request("https://example.com/api/health/import", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function configureServer() {
  process.env.HEALTH_IMPORT_TOKEN = "health-import-secret";
  process.env.HEALTH_TRACKER_OWNER_ID = "owner-id";
  process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON = "{}";
}

function useInMemoryStores(initialDaily: Record<string, unknown> = {}, initialBody: Record<string, unknown> = {}) {
  let dailyStored = { ...initialDaily };
  let bodyStored = { ...initialBody };
  const importsStored = new Map<string, Record<string, unknown>>();
  const dailySet = vi.fn(async (value: Record<string, unknown>, options?: { merge?: boolean }) => {
    dailyStored = options?.merge ? { ...dailyStored, ...value } : { ...value };
  });
  const bodySet = vi.fn(async (value: Record<string, unknown>, options?: { merge?: boolean }) => {
    bodyStored = options?.merge ? { ...bodyStored, ...value } : { ...value };
  });
  const doc = vi.fn((path: string) => ({
    path,
    get: vi.fn().mockResolvedValue({ data: () => path.includes("/healthImports/") ? importsStored.get(path.split("/").pop() ?? "") : path.includes("/bodyLogs/") ? bodyStored : dailyStored }),
  }));
  const transaction = {
    get: vi.fn(async (reference: { path: string }) => ({ data: () => reference.path.includes("/healthImports/") ? importsStored.get(reference.path.split("/").pop() ?? "") : reference.path.includes("/bodyLogs/") ? bodyStored : dailyStored })),
    set: vi.fn((reference: { path: string }, value: Record<string, unknown>, options?: { merge?: boolean }) => {
      if (reference.path.includes("/healthImports/")) importsStored.set(reference.path.split("/").pop() ?? "", value);
      else if (reference.path.includes("/bodyLogs/")) void bodySet(value, options);
      else void dailySet(value, options);
      return transaction;
    }),
    commit: vi.fn().mockResolvedValue(undefined),
  };
  const batch = {
    set: vi.fn((reference: { path: string }, value: Record<string, unknown>, options?: { merge?: boolean }) => {
      if (reference.path.includes("/bodyLogs/")) void bodySet(value, options);
      else void dailySet(value, options);
      return batch;
    }),
    commit: vi.fn().mockResolvedValue(undefined),
  };
  const runTransaction = vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => { const result = await callback(transaction); await transaction.commit(); return result; });
  getAdminDb.mockReturnValue({ doc, batch: vi.fn(() => batch), runTransaction });
  return {
    doc,
    dailySet,
    bodySet,
    dailyStored: () => dailyStored,
    bodyStored: () => bodyStored,
    batch,
    transaction,
  };
}

describe("Apple Health import route", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    getAdminDb.mockReset();
    configureServer();
  });

  it("imports a valid total step count into the existing daily document", async () => {
    const database = useInMemoryStores();

    const response = await POST(request(validPayload));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, date: "2026-08-29", steps: 5234, accepted: true });
    expect(database.doc).toHaveBeenCalledWith("users/owner-id/dailyLogs/2026-08-29");
    expect(database.doc).toHaveBeenCalledWith("users/owner-id/bodyLogs/2026-08-29");
    expect(database.dailySet).toHaveBeenCalledWith(expect.objectContaining({
      date: "2026-08-29",
      steps: 5234,
      source: "apple_health",
      syncedAt: new Date("2026-08-29T15:35:00+08:00"),
      updatedAt: expect.anything(),
    }), { merge: true });
    expect(database.bodySet).toHaveBeenCalledWith(expect.objectContaining({
      date: "2026-08-29",
      steps: 5234,
      updatedAt: expect.anything(),
      createdAt: expect.anything(),
    }), { merge: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("imports up to seven daily totals in one batch", async () => {
    const database = useInMemoryStores();
    const records = [1, 2, 3].map(offset => ({
      date: `2026-08-${String(29 - offset).padStart(2, "0")}`,
      steps: offset * 1000,
      syncedAt: `2026-08-${String(29 - offset).padStart(2, "0")}T22:55:00+08:00`,
    }));

    const response = await POST(request({ source: "apple_health", records }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      records: records.map(({ date, steps }) => ({ date, steps, accepted: true })),
    });
    expect(database.dailySet).toHaveBeenCalledTimes(3);
    expect(database.bodySet).toHaveBeenCalledTimes(3);
    for (const record of records) {
      expect(database.doc).toHaveBeenCalledWith(`users/owner-id/dailyLogs/${record.date}`);
      expect(database.doc).toHaveBeenCalledWith(`users/owner-id/bodyLogs/${record.date}`);
    }
  });

  it("rejects batches larger than seven days or with duplicate dates", async () => {
    const tooMany = Array.from({ length: 8 }, (_, index) => ({
      date: `2026-08-${String(index + 1).padStart(2, "0")}`,
      steps: index,
      syncedAt: "2026-08-29T22:55:00+08:00",
    }));
    expect((await POST(request({ source: "apple_health", records: tooMany }))).status).toBe(400);

    const duplicate = [validPayload, { ...validPayload, steps: 999 }];
    expect((await POST(request({ source: "apple_health", records: duplicate }))).status).toBe(400);
  });
  it("rejects an invalid bearer token", async () => {
    const response = await POST(request(validPayload, "wrong-secret"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(getAdminDb).not.toHaveBeenCalled();
  });

  it("rejects missing steps", async () => {
    const payload: Partial<typeof validPayload> = { ...validPayload };
    delete payload.steps;
    const response = await POST(request(payload));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_request" });
  });

  it("rejects negative steps", async () => {
    const response = await POST(request({ ...validPayload, steps: -1 }));
    expect(response.status).toBe(400);
  });

  it("rejects an invalid date", async () => {
    const response = await POST(request({ ...validPayload, date: "2026-02-30" }));
    expect(response.status).toBe(400);
  });

  it("overwrites repeated sync totals instead of accumulating them", async () => {
    const database = useInMemoryStores();

    await POST(request({ ...validPayload, steps: 3200, syncedAt: "2026-08-29T12:00:00+08:00" }));
    await POST(request({ ...validPayload, steps: 7100, syncedAt: "2026-08-29T18:00:00+08:00" }));
    await POST(request({ ...validPayload, steps: 10300, syncedAt: "2026-08-29T23:50:00+08:00" }));

    expect(database.dailyStored().steps).toBe(10300);
    expect(database.bodyStored().steps).toBe(10300);
    expect(database.dailySet).toHaveBeenCalledTimes(3);
    expect(database.bodySet).toHaveBeenCalledTimes(3);
    expect(database.dailySet.mock.calls.every(([, options]) => options?.merge === true)).toBe(true);
  });

  it("accepts a sync id and commits daily and body writes atomically", async () => {
    const database = useInMemoryStores();

    const record = { date: validPayload.date, steps: validPayload.steps, syncedAt: validPayload.syncedAt };
    const response = await POST(request({ source: "apple_health", syncId: "sync-2026-08-29", records: [record] }));

    expect(response.status).toBe(200);
    expect(database.transaction.commit).toHaveBeenCalledOnce();
    expect(database.transaction.set.mock.calls.map(([reference]) => reference.path)).toEqual([
      "users/owner-id/dailyLogs/2026-08-29",
      "users/owner-id/bodyLogs/2026-08-29",
      "users/owner-id/healthImports/sync-2026-08-29",
    ]);
    expect(database.transaction.set.mock.calls.slice(0, 2).every(([, value]) => value.syncId === "sync-2026-08-29")).toBe(true);
  });

  it("replays the same sync id and rejects a changed payload", async () => {
    const database = useInMemoryStores();
    const first = await POST(request({ source: "apple_health", syncId: "sync-replay", records: [{ date: "2026-08-29", steps: 5234, syncedAt: "2026-08-29T15:35:00+08:00" }] }));
    const replay = await POST(request({ source: "apple_health", syncId: "sync-replay", records: [{ date: "2026-08-29", steps: 5234, syncedAt: "2026-08-29T15:35:00+08:00" }] }));
    const conflict = await POST(request({ source: "apple_health", syncId: "sync-replay", records: [{ date: "2026-08-29", steps: 9999, syncedAt: "2026-08-29T15:35:00+08:00" }] }));

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "sync_id_conflict" });
    expect(database.transaction.commit).toHaveBeenCalledTimes(2);
  });

  it("does not overwrite a newer sync", async () => {
    const database = useInMemoryStores();
    await POST(request({ ...validPayload, syncId: "sync-new", steps: 9000, syncedAt: "2026-08-29T23:00:00+08:00" }));
    const stale = await POST(request({ ...validPayload, syncId: "sync-old", steps: 1000, syncedAt: "2026-08-29T22:00:00+08:00" }));

    expect(stale.status).toBe(200);
    expect(await stale.json()).toMatchObject({ accepted: false, reason: "stale_sync" });
    expect(database.dailyStored().steps).toBe(9000);
  });

  it("preserves unrelated fields on the daily health record", async () => {
    const database = useInMemoryStores(
      { waterMl: 1800, weightKg: 72.4, note: "keep me" },
      { weightKg: 72.4, note: "body note" },
    );

    await POST(request(validPayload));

    expect(database.dailyStored()).toMatchObject({
      waterMl: 1800,
      weightKg: 72.4,
      note: "keep me",
      steps: 5234,
      source: "apple_health",
    });
    expect(database.bodyStored()).toMatchObject({
      weightKg: 72.4,
      note: "body note",
      steps: 5234,
    });
  });

  it("returns 500 when the write fails", async () => {
    getAdminDb.mockReturnValue({
      doc: vi.fn(() => ({ set: vi.fn().mockRejectedValue(new Error("Firestore unavailable")) })),
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request(validPayload));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "operation_failed" });
    consoleError.mockRestore();
  });
});
