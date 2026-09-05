import type { Nutrition } from "./nutrition";

const nutritionKeys: (keyof Nutrition)[] = ["caloriesKcal", "proteinG", "carbsG", "fatG", "fiberG", "sugarG", "saturatedFatG", "transFatG", "sodiumMg", "potassiumMg", "cholesterolMg", "caffeineMg"];

export function dailySummaryFields(total: Nutrition): Record<string, number> {
  return Object.fromEntries(nutritionKeys.map(key => [`total${key[0].toUpperCase()}${key.slice(1)}`, total[key] ?? 0]));
}

export function nutritionFromDailyData(data: Record<string, unknown>): Nutrition | null {
  if (typeof data.totalCaloriesKcal !== "number") return null;
  return Object.fromEntries(nutritionKeys.map(key => {
    const field = `total${key[0].toUpperCase()}${key.slice(1)}`;
    return [key, typeof data[field] === "number" ? data[field] : 0];
  })) as Nutrition;
}