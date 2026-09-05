import { describe, expect, it } from "vitest";
import { buildHistoryExportDay, validateHistoryExport } from "../lib/history-export";
import type { FoodEntry } from "../lib/nutrition";

const validExport = {
  schema_version: "3.0",
  exported_at: "2026-09-05T15:00:00.000Z",
  timezone: "Asia/Taipei",
  profile: { height_cm: 175 },
  targets: { caloriesKcal: { min: 1800, max: 2200 } },
  date_range: { start: "2026-09-01", end: "2026-09-05" },
  daily_records: [
    {
      date: "2026-09-04",
      weight_kg: 72.4,
      water_ml: 1800,
      steps: 8342,
      steps_note: "Apple Health",
      meals: [{ meal: "晚餐", items: [{ name: "便當", quantity: 1, nutrition: { calories_kcal: 545, protein_g: 30, estimated: true } }] }],
      beverages: [{ name: "茶", volume_ml: 500, nutrition: { calories_kcal: 0 } }],
    },
    { date: "2026-09-05" },
  ],
};

const entry = (partial: Partial<FoodEntry> & Pick<FoodEntry, "id" | "name" | "mealType">): FoodEntry => ({
  brand: null,
  category: null,
  servings: 1,
  consumedPercent: 100,
  servingWeightG: null,
  hydrationMl: 0,
  time: "12:00",
  notes: null,
  caloriesKcal: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  fiberG: 0,
  sugarG: 0,
  saturatedFatG: 0,
  transFatG: null,
  sodiumMg: 0,
  potassiumMg: null,
  cholesterolMg: null,
  caffeineMg: 0,
  confidence: "high",
  ...partial,
});

describe("history export validation", () => {
  it("returns a destructive-scope preview for a valid v3 export", () => {
    const result = validateHistoryExport(validExport);
    expect(result).toMatchObject({
      ok: true,
      preview: {
        startDate: "2026-09-01",
        endDate: "2026-09-05",
        dayCount: 2,
        entryCount: 1,
        beverageCount: 1,
        waterDayCount: 1,
        bodyMetricDayCount: 1,
      },
    });
  });

  it("rejects unsupported versions and malformed JSON shapes", () => {
    expect(validateHistoryExport({ ...validExport, schema_version: "2.0" })).toEqual({ ok: false, error: expect.any(String) });
    expect(validateHistoryExport({ ...validExport, daily_records: [] })).toEqual({ ok: false, error: expect.any(String) });
    expect(validateHistoryExport({ ...validExport, date_range: { start: "2026-09-05", end: "2026-09-01" } })).toEqual({ ok: false, error: expect.any(String) });
  });

  it("rejects duplicate or out-of-range daily records", () => {
    expect(validateHistoryExport({ ...validExport, daily_records: [validExport.daily_records[0], validExport.daily_records[0]] })).toEqual({ ok: false, error: expect.any(String) });
    expect(validateHistoryExport({ ...validExport, daily_records: [{ ...validExport.daily_records[0], date: "2026-09-06" }] })).toEqual({ ok: false, error: expect.any(String) });
  });
});

describe("buildHistoryExportDay", () => {
  it("keeps meals and beverages when entries are provided, even if overview totals already exist", () => {
    const day = buildHistoryExportDay({
      date: "2026-09-05",
      waterMl: 1700,
      weightKg: null,
      steps: 5000,
      entries: [
        entry({ id: "1", name: "雞胸", mealType: "午餐", caloriesKcal: 200, proteinG: 40, category: "雞胸類" }),
        entry({ id: "2", name: "Coke Zero", mealType: "飲料", caloriesKcal: 0, hydrationMl: 330, category: "飲料" }),
      ],
    });

    expect(day).toMatchObject({
      date: "2026-09-05",
      water_ml: 1700,
      weight_kg: null,
      steps: 5000,
      meals: [{ meal: "午餐", items: [{ name: "雞胸", quantity: 1, nutrition: { calories_kcal: 200, protein_g: 40, estimated: false } }] }],
      beverages: [{ name: "Coke Zero", volume_ml: 330, nutrition: { calories_kcal: 0, estimated: false } }],
    });

    const validated = validateHistoryExport({
      schema_version: "3.0",
      exported_at: "2026-09-06T00:00:00.000Z",
      timezone: "Asia/Taipei",
      date_range: { start: "2026-09-05", end: "2026-09-05" },
      daily_records: [day],
    });
    expect(validated).toMatchObject({
      ok: true,
      preview: { dayCount: 1, entryCount: 1, beverageCount: 1, waterDayCount: 1, bodyMetricDayCount: 1 },
    });
  });

  it("exports empty meals/beverages only when the day truly has no entries", () => {
    expect(buildHistoryExportDay({ date: "2026-09-05", waterMl: 500, entries: [] })).toEqual({
      date: "2026-09-05",
      weight_kg: null,
      water_ml: 500,
      steps: null,
      meals: [],
      beverages: [],
    });
  });
});
