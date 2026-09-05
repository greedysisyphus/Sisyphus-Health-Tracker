import { describe, expect, it } from "vitest";
import { dailySummaryFields, nutritionFromDailyData } from "../lib/daily-summary";

describe("daily summary", () => {
  it("serializes and reads the canonical nutrition totals", () => {
    const total = { caloriesKcal: 1800, proteinG: 120, carbsG: 200, fatG: 60, fiberG: 31, sugarG: 40, saturatedFatG: 15, transFatG: 0, sodiumMg: 1800, potassiumMg: 2500, cholesterolMg: 200, caffeineMg: 90 };
    expect(nutritionFromDailyData(dailySummaryFields(total))).toEqual(total);
  });

  it("returns null when a daily document has no summary", () => {
    expect(nutritionFromDailyData({ date: "2026-09-05" })).toBeNull();
  });
});