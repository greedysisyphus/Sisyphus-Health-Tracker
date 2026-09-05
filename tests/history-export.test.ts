import { describe, expect, it } from "vitest";
import { validateHistoryExport } from "../lib/history-export";

const validExport = {
  schema_version: "3.0",
  exported_at: "2026-09-05T15:00:00.000Z",
  timezone: "Asia/Taipei",
  date_range: { start: "2026-09-01", end: "2026-09-05" },
  daily_records: [
    {
      date: "2026-09-04",
      weight_kg: 72.4,
      water_ml: 1800,
      steps: 8342,
      meals: [{ meal: "晚餐", items: [{ name: "便當", quantity: 1, nutrition: { calories_kcal: 545, protein_g: 30 } }] }],
      beverages: [{ name: "茶", volume_ml: 500, nutrition: { calories_kcal: 0 } }],
    },
    { date: "2026-09-05", weight_kg: null, water_ml: null, steps: null, meals: [], beverages: [] },
  ],
};

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
