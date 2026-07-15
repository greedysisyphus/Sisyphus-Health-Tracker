import { describe, expect, it } from "vitest";
import { calculateDailyNutrition, calculateHydrationSummary, calculateNutritionByPortion, calculateRemainingCalories, calculateSevenDayAverage, getWeekRange, normalizeFoodRecord } from "../lib/nutrition";

describe("nutrition utilities", () => {
  it("scales all nutrients by servings", () => expect(calculateNutritionByPortion({ caloriesKcal: 200, proteinG: 20, carbsG: 10, fatG: 5, sugarG: 1, fiberG: 2, saturatedFatG: 1, transFatG: null, sodiumMg: 200, potassiumMg: null, cholesterolMg: null, caffeineMg: 0 }, 1.5)).toMatchObject({ caloriesKcal: 300, proteinG: 30, fatG: 7.5 }));
  it("adds a daily log and treats legacy records as one serving", () => expect(calculateDailyNutrition([normalizeFoodRecord({ id: "a", name: "蛋", meal: "早餐", calories: 75, protein: 7, carbs: 1, fat: 5, sugar: 0, fiber: 0, saturatedFat: 1, sodium: 300, portion: 1, unit: "顆", time: "08:00" })]).caloriesKcal).toBe(75));
  it("adds every new nutrient without NaN when optional fields are missing", () => {
    const total = calculateDailyNutrition([normalizeFoodRecord({ id: "b", name: "豆漿", mealType: "早餐", servings: 2, caloriesKcal: 140, proteinG: 14, carbsG: 5, fatG: 7, fiberG: 3, sugarG: 2, saturatedFatG: 1, sodiumMg: 60, caffeineMg: 0 })]);
    expect(total).toMatchObject({ caloriesKcal: 280, fiberG: 6, sugarG: 4, sodiumMg: 120, caffeineMg: 0, potassiumMg: 0, cholesterolMg: 0 });
    expect(Object.values(total).some(value => typeof value === "number" && Number.isNaN(value))).toBe(false);
  });
  it("keeps negative remaining calories", () => expect(calculateRemainingCalories(1850, 1900)).toBe(-50));
  it("ignores missing weights in seven day average", () => expect(calculateSevenDayAverage([76, null, 75.8])).toBe(75.9));
  it("calculates a week across month boundary", () => expect(getWeekRange(new Date("2026-08-01T12:00:00+08:00")).start).toBe("2026-07-27"));
  it("separates plain water from hydration provided by drinks", () => {
    const drink = normalizeFoodRecord({ id: "drink", name: "Coke Zero", hydrationMl: 330 });
    expect(calculateHydrationSummary([drink], 900)).toEqual({ totalWaterMl: 900, beverageWaterMl: 330, plainWaterMl: 570 });
  });
  it("scales nutrition by the consumed percentage", () => {
    const entry = normalizeFoodRecord({ id: "meal", name: "餐盒", servings: 1, consumedPercent: 50, caloriesKcal: 600, proteinG: 40 });
    expect(calculateDailyNutrition([entry])).toMatchObject({ caloriesKcal: 300, proteinG: 20 });
  });
});
