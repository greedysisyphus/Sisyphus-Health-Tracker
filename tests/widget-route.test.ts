import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getAdminDb } = vi.hoisted(() => ({ getAdminDb: vi.fn() }));

vi.mock("../lib/firebase-admin", () => ({ getAdminDb }));

import { GET } from "../app/api/widget/today/route";

const originalEnv = { ...process.env };
const request = (token?: string) => new Request("https://example.com/api/widget/today", {
  headers: token ? { Authorization: `Bearer ${token}` } : undefined,
});

function configureServer() {
  process.env.WIDGET_READ_TOKEN = "widget-secret";
  process.env.HEALTH_TRACKER_OWNER_ID = "owner-id";
  process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON = "{}";
}

describe("widget today route", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    getAdminDb.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns server_not_configured without a widget token", async () => {
    delete process.env.WIDGET_READ_TOKEN;

    const response = await GET(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "server_not_configured" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it.each([undefined, "wrong-secret"])("returns 401 for a missing or invalid bearer token", async token => {
    configureServer();

    const response = await GET(request(token));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(getAdminDb).not.toHaveBeenCalled();
  });

  it("uses the Taipei date and returns only compact aggregate data", async () => {
    configureServer();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T16:30:00.000Z"));
    const entries = {
      docs: [{ data: () => ({
        caloriesKcal: 620,
        proteinG: 43,
        fiberG: 7.1,
        sodiumMg: 910,
        caffeineMg: 90,
        servings: 2,
        consumedPercent: 100,
      }) }],
    };
    const daily = { waterMl: 1350, steps: 6420, weightKg: 72.9 };
    const dayRef = {
      collection: vi.fn(() => ({ get: vi.fn().mockResolvedValue(entries) })),
      get: vi.fn().mockResolvedValue({ data: () => daily }),
    };
    const doc = vi.fn(() => dayRef);
    getAdminDb.mockReturnValue({ doc });

    const response = await GET(request("widget-secret"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      date: "2026-08-25",
      caloriesKcal: 1240,
      proteinG: 86,
      fiberG: 14.2,
      sodiumMg: 1820,
      caffeineMg: 180,
      waterMl: 1350,
      steps: 6420,
      weightKg: 72.9,
    });
    expect(doc).toHaveBeenCalledWith("users/owner-id/dailyLogs/2026-08-25");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns zero totals and null body data when the day is missing", async () => {
    configureServer();
    const dayRef = {
      collection: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })),
      get: vi.fn().mockResolvedValue({ data: () => undefined }),
    };
    getAdminDb.mockReturnValue({ doc: vi.fn(() => dayRef) });

    const response = await GET(request("widget-secret"));
    const body = await response.json();

    expect(body).toMatchObject({
      caloriesKcal: 0,
      proteinG: 0,
      fiberG: 0,
      sodiumMg: 0,
      caffeineMg: 0,
      waterMl: 0,
      steps: null,
      weightKg: null,
    });
  });
});
