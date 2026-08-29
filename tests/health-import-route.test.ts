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

function useInMemoryDailyDocument(initial: Record<string, unknown> = {}) {
  let stored = { ...initial };
  const set = vi.fn(async (value: Record<string, unknown>, options?: { merge?: boolean }) => {
    stored = options?.merge ? { ...stored, ...value } : { ...value };
  });
  const doc = vi.fn(() => ({ set }));
  getAdminDb.mockReturnValue({ doc });
  return { doc, set, stored: () => stored };
}

describe("Apple Health import route", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    getAdminDb.mockReset();
    configureServer();
  });

  it("imports a valid total step count into the existing daily document", async () => {
    const database = useInMemoryDailyDocument();

    const response = await POST(request(validPayload));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, date: "2026-08-29", steps: 5234 });
    expect(database.doc).toHaveBeenCalledWith("users/owner-id/dailyLogs/2026-08-29");
    expect(database.set).toHaveBeenCalledWith(expect.objectContaining({
      date: "2026-08-29",
      steps: 5234,
      source: "apple_health",
      syncedAt: new Date("2026-08-29T15:35:00+08:00"),
      updatedAt: expect.anything(),
    }), { merge: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
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
    const database = useInMemoryDailyDocument();

    await POST(request({ ...validPayload, steps: 3200, syncedAt: "2026-08-29T12:00:00+08:00" }));
    await POST(request({ ...validPayload, steps: 7100, syncedAt: "2026-08-29T18:00:00+08:00" }));
    await POST(request({ ...validPayload, steps: 10300, syncedAt: "2026-08-29T23:50:00+08:00" }));

    expect(database.stored().steps).toBe(10300);
    expect(database.set).toHaveBeenCalledTimes(3);
    expect(database.set.mock.calls.every(([, options]) => options?.merge === true)).toBe(true);
  });

  it("preserves unrelated fields on the daily health record", async () => {
    const database = useInMemoryDailyDocument({ waterMl: 1800, weightKg: 72.4, note: "keep me" });

    await POST(request(validPayload));

    expect(database.stored()).toMatchObject({
      waterMl: 1800,
      weightKg: 72.4,
      note: "keep me",
      steps: 5234,
      source: "apple_health",
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
