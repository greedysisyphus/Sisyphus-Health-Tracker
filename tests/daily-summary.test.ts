import { describe, expect, it } from "vitest";
import { totalForEntryData } from "../lib/agent-health";
import { dailySummaryFields, nutritionFromDailyData } from "../lib/daily-summary";

describe("daily summary", () => {
  it("serializes and reads the canonical nutrition totals", () => {
    const total = { caloriesKcal: 1800, proteinG: 120, carbsG: 200, fatG: 60, fiberG: 31, sugarG: 40, saturatedFatG: 15, transFatG: 0, sodiumMg: 1800, potassiumMg: 2500, cholesterolMg: 200, caffeineMg: 90 };
    expect(nutritionFromDailyData(dailySummaryFields(total))).toEqual(total);
  });

  it("builds a summary from legacy imported nutrition fields", () => {
    const total = totalForEntryData([
      { calories: 500, protein: 30, carbs: 45, fat: 18, fiber: 7, sodium: 600 },
      { calories: 120, protein: 4, carbs: 20, fat: 3, sugar: 8, caffeine: 80 },
    ]);
    expect(nutritionFromDailyData({ ...dailySummaryFields(total), entryCount: 2 })).toMatchObject({
      caloriesKcal: 620,
      proteinG: 34,
      carbsG: 65,
      fatG: 21,
      fiberG: 7,
      sugarG: 8,
      sodiumMg: 600,
      caffeineMg: 80,
    });
  });

  it("returns null when a daily document has no summary", () => {
    expect(nutritionFromDailyData({ date: "2026-09-05" })).toBeNull();
  });
});
