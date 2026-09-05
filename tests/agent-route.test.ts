import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAdminDb } = vi.hoisted(() => ({ getAdminDb: vi.fn() }));
vi.mock("../lib/firebase-admin", () => ({ getAdminDb }));

import { POST } from "../app/api/agent/route";

const secret = "test-secret";
const document = (id: string, data: Record<string, unknown>) => ({ id, ref: { id }, data: () => data });
const requestFor = (body: Record<string, unknown>) => {
  const raw = JSON.stringify(body);
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  return new Request("https://tracker.test/api/agent", { method: "POST", body: raw, headers: { "x-health-timestamp": timestamp, "x-health-signature": signature } });
};

beforeEach(() => {
  process.env = { ...process.env, HERMES_API_SECRET: secret, HEALTH_TRACKER_OWNER_ID: "owner" };
  getAdminDb.mockReset();
});

describe("agent route food search", () => {
  it("uses indexed search and merges bounded legacy fallback", async () => {
    const indexed = document("indexed", { id: "indexed", name: "光泉無糖黑豆漿", useCount: 2, searchTokens: ["豆漿"] });
    const legacy = document("legacy", { id: "legacy", name: "大醇豆無加糖豆漿", useCount: 4 });
    const indexedQuery = { get: vi.fn().mockResolvedValue({ docs: [indexed] }) };
    const legacyQuery = { get: vi.fn().mockResolvedValue({ docs: [legacy, indexed] }) };
    const collection = {
      where: vi.fn(() => ({ limit: vi.fn(() => indexedQuery) })),
      orderBy: vi.fn(() => ({ limit: vi.fn(() => legacyQuery) })),
    };
    getAdminDb.mockReturnValue({ collection: vi.fn(() => collection) });

    const response = await POST(requestFor({ action: "find_foods", query: "豆漿", limit: 10 }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, action: "find_foods" });
    expect(body.foods.map((food: { id: string }) => food.id)).toEqual(["legacy", "indexed"]);
    expect(collection.where).toHaveBeenCalledWith("searchTokens", "array-contains", "豆漿");
    expect(collection.orderBy).toHaveBeenCalledWith("name");
  });

  it("uses the bounded name query for an empty search", async () => {
    const first = document("first", { name: "蛋", useCount: 1 });
    const query = { get: vi.fn().mockResolvedValue({ docs: [first] }) };
    const collection = { orderBy: vi.fn(() => ({ limit: vi.fn(() => query) })) };
    getAdminDb.mockReturnValue({ collection: vi.fn(() => collection) });

    const response = await POST(requestFor({ action: "find_foods", query: "", limit: 3 }));
    expect(response.status).toBe(200);
    expect((await response.json()).foods).toHaveLength(1);
    expect(collection.orderBy).toHaveBeenCalledWith("name");
  });
});

describe("agent route food search migration", () => {
  it("writes tokens for every existing food through the batch writer", async () => {
    const docs = [document("a", { name: "光泉豆漿", brand: "光泉", category: "乳飲" }), document("b", { name: "茶葉蛋", category: "蛋類" })];
    const set = vi.fn();
    const commit = vi.fn().mockResolvedValue(undefined);
    const batch = { set, delete: vi.fn(), commit };
    getAdminDb.mockReturnValue({ collection: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs, size: docs.length }) })), batch: vi.fn(() => batch) });

    const response = await POST(requestFor({ action: "backfill_food_search_tokens" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, action: "backfill_food_search_tokens", updatedFoods: 2 });
    expect(set).toHaveBeenCalledTimes(2);
    expect(set.mock.calls[0][1].searchTokens).toContain("豆漿");
    expect(commit).toHaveBeenCalledOnce();
  });
});

describe("agent route body metric fallback", () => {
  it("resolves steps and weight independently across dailyLogs and bodyLogs", async () => {
    const entries = { get: vi.fn().mockResolvedValue({ docs: [] }) };
    const daily = { get: vi.fn().mockResolvedValue({ data: () => ({ steps: 4567, weightKg: 73.1 }) }), collection: vi.fn(() => entries) };
    const body = { get: vi.fn().mockResolvedValue({ data: () => ({ steps: 8123 }) }) };
    const db = { doc: vi.fn((path: string) => path.includes("/bodyLogs/") ? body : daily) };
    getAdminDb.mockReturnValue(db);

    const response = await POST(requestFor({ action: "get_daily_summary", date: "2026-08-29" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ steps: 8123, weightKg: 73.1 });
  });
});

describe("agent route history export", () => {
  it("accepts the web export shape and writes imported entries plus summaries", async () => {
    const set = vi.fn();
    const deleteDocument = vi.fn();
    const commit = vi.fn().mockResolvedValue(undefined);
    const batch = { set, delete: deleteDocument, commit };
    const entryCollection = { get: vi.fn().mockResolvedValue({ docs: [], size: 0 }), doc: vi.fn((id: string) => ({ path: `users/owner/dailyLogs/2026-08-29/entries/${id}`, id })) };
    const existingDay = { get: vi.fn().mockResolvedValue({ data: () => ({ waterMl: 1800 }) }), collection: vi.fn(() => entryCollection) };
    const db = {
      doc: vi.fn((path: string) => path.includes("dailyLogs/2026-08-29") ? existingDay : { path, ref: { path } }),
      batch: vi.fn(() => batch),
    };
    getAdminDb.mockReturnValue(db);

    const response = await POST(requestFor({
      action: "replace_history_export",
      preserveExistingWaterDates: ["2026-08-29"],
      data: {
        schema_version: "3.0",
        daily_records: [{
          date: "2026-08-29",
          weight_kg: 72.4,
          water_ml: null,
          steps: 5234,
          meals: [{ meal: "早餐", items: [{ name: "茶葉蛋", quantity: 2, nutrition: { calories_kcal: 140, protein_g: 12, estimated: false } }] }],
          beverages: [{ name: "無糖豆漿", quantity: 1, volume_ml: 300, nutrition: { calories_kcal: 120, protein_g: 10 } }],
        }],
      },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, action: "replace_history_export", importedDays: 1, importedEntries: 2 });
    expect(deleteDocument).not.toHaveBeenCalled();
    expect(set.mock.calls.map(([, value]) => value)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "茶葉蛋", mealType: "其他", caloriesKcal: 140, proteinG: 12, confidence: "high" }),
      expect.objectContaining({ name: "無糖豆漿", mealType: "飲料", caloriesKcal: 120, proteinG: 10, hydrationMl: 300 }),
      expect.objectContaining({ totalCaloriesKcal: 260, totalProteinG: 22, entryCount: 2 }),
    ]));
    expect(commit).toHaveBeenCalledOnce();
  });
});
