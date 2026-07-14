import { describe, expect, it } from "vitest";
import { calculateDailyTotals, calculateNutritionByPortion, calculateRemainingCalories, calculateSevenDayAverage, getWeekRange } from "../lib/nutrition";

describe("nutrition utilities", () => {
  it("scales all nutrients by portion", () => expect(calculateNutritionByPortion({ calories: 200, protein: 20, carbs: 10, fat: 5, sugar: 1, fiber: 2, saturatedFat: 1, sodium: 200 }, 1.5)).toMatchObject({ calories: 300, protein: 30, fat: 7.5 }));
  it("adds a daily log", () => expect(calculateDailyTotals([{ id: "a", name: "蛋", meal: "早餐", calories: 75, protein: 7, carbs: 1, fat: 5, sugar: 0, fiber: 0, saturatedFat: 1, sodium: 300, portion: 1, unit: "顆", time: "08:00" }]).calories).toBe(75));
  it("keeps negative remaining calories", () => expect(calculateRemainingCalories(1850, 1900)).toBe(-50));
  it("ignores missing weights in seven day average", () => expect(calculateSevenDayAverage([76, null, 75.8])).toBe(75.9));
  it("calculates a week across month boundary", () => expect(getWeekRange(new Date("2026-08-01T12:00:00+08:00")).start).toBe("2026-07-27"));
});
