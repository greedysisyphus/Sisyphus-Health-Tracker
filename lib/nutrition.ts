export type MealType = "早餐" | "午餐" | "晚餐" | "點心" | "飲料" | "宵夜" | "其他";

export type Nutrition = {
  caloriesKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sugarG: number;
  saturatedFatG: number;
  transFatG: number | null;
  sodiumMg: number;
  potassiumMg: number | null;
  cholesterolMg: number | null;
  caffeineMg: number;
};

export type FoodEntry = Nutrition & {
  id: string;
  date?: string;
  name: string;
  brand: string | null;
  category: string | null;
  mealType: MealType;
  servings: number;
  consumedPercent: number;
  servingWeightG: number | null;
  hydrationMl: number;
  time: string;
  notes: string | null;
  source?: string;
  confidence?: string;
  sourceFoodId?: string;
};

export type FoodRecordInput = Omit<FoodEntry, "id" | "date" | "time"> & { id?: string; time?: string };

export type HydrationSummary = {
  plainWaterMl: number;
  beverageWaterMl: number;
  totalWaterMl: number;
};

export const meals: MealType[] = ["早餐", "午餐", "晚餐", "點心", "飲料", "宵夜", "其他"];

/** Fine-grained food/drink labels stored on entries and saved foods. */
export const foodCategories = [
  "主食", "肉類", "海鮮", "蛋類", "乳製品", "豆類", "蔬菜", "水果", "堅果",
  "飲料", "咖啡茶飲", "乳飲",
  "零食", "餐盒", "醬料", "其他",
] as const;

export type FoodCategory = typeof foodCategories[number];
export type FoodCategoryGroupId = "all" | "drink" | "food" | "other";

export const foodCategoryGroups: {
  id: Exclude<FoodCategoryGroupId, "all">;
  label: string;
  categories: readonly FoodCategory[];
}[] = [
  { id: "drink", label: "飲品類", categories: ["飲料", "咖啡茶飲", "乳飲"] },
  {
    id: "food",
    label: "食物類",
    categories: ["主食", "肉類", "海鮮", "蛋類", "乳製品", "豆類", "蔬菜", "水果", "堅果", "零食", "餐盒", "醬料"],
  },
  { id: "other", label: "其他", categories: ["其他"] },
];

const drinkCategorySet = new Set<string>(foodCategoryGroups.find(group => group.id === "drink")!.categories);
const foodCategorySet = new Set<string>(foodCategoryGroups.find(group => group.id === "food")!.categories);

/** Map a stored category (+ optional hydration) into 飲品類 / 食物類 / 其他. */
export function categoryGroupOf(category: string | null | undefined, hydrationMl = 0): Exclude<FoodCategoryGroupId, "all"> {
  if (category && drinkCategorySet.has(category)) return "drink";
  if (category && foodCategorySet.has(category)) return "food";
  // Legacy drinks often only have hydration and no category / 其他.
  if (hydrationMl > 0 && (!category || category === "其他")) return "drink";
  return "other";
}

export function isDrinkCategory(category: string | null | undefined, hydrationMl = 0): boolean {
  return categoryGroupOf(category, hydrationMl) === "drink";
}

export function foodCategoryGroupLabel(group: Exclude<FoodCategoryGroupId, "all">): string {
  return foodCategoryGroups.find(item => item.id === group)?.label ?? "其他";
}

export const emptyNutrition = (): Nutrition => ({ caloriesKcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sugarG: 0, saturatedFatG: 0, transFatG: null, sodiumMg: 0, potassiumMg: null, cholesterolMg: null, caffeineMg: 0 });

const numberOr = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
const nullableNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const textOrNull = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

/** Normalizes historical Firestore entries without changing the stored document. */
export function normalizeFoodRecord(raw: Record<string, unknown>, id?: string): FoodEntry {
  const oldMeal = typeof raw.meal === "string" ? raw.meal : "其他";
  const mealType = meals.includes(oldMeal as MealType) ? oldMeal as MealType : "其他";
  const oldUnit = typeof raw.unit === "string" ? raw.unit : "";
  const oldPortion = numberOr(raw.portion, 1);
  const isCanonical = raw.servings !== undefined || raw.caloriesKcal !== undefined;
  return {
    id: typeof raw.id === "string" ? raw.id : id ?? crypto.randomUUID(),
    ...(typeof raw.date === "string" ? { date: raw.date } : {}),
    name: textOrNull(raw.name) ?? "未命名食物",
    brand: textOrNull(raw.brand),
    category: textOrNull(raw.category),
    mealType: (raw.mealType && meals.includes(raw.mealType as MealType) ? raw.mealType : mealType) as MealType,
    // Legacy entries store their final consumed values. Treat them as one serving.
    servings: isCanonical ? Math.max(numberOr(raw.servings, 1), 0.1) : 1,
    consumedPercent: Math.min(100, Math.max(0, numberOr(raw.consumedPercent, 100))),
    servingWeightG: nullableNumber(raw.servingWeightG) ?? (!isCanonical && oldUnit === "g" ? oldPortion : null),
    caloriesKcal: numberOr(raw.caloriesKcal ?? raw.calories),
    proteinG: numberOr(raw.proteinG ?? raw.protein),
    carbsG: numberOr(raw.carbsG ?? raw.carbs),
    fatG: numberOr(raw.fatG ?? raw.fat),
    fiberG: numberOr(raw.fiberG ?? raw.fiber),
    sugarG: numberOr(raw.sugarG ?? raw.sugar),
    saturatedFatG: numberOr(raw.saturatedFatG ?? raw.saturatedFat),
    transFatG: nullableNumber(raw.transFatG),
    sodiumMg: numberOr(raw.sodiumMg ?? raw.sodium),
    potassiumMg: nullableNumber(raw.potassiumMg),
    cholesterolMg: nullableNumber(raw.cholesterolMg),
    caffeineMg: numberOr(raw.caffeineMg),
    hydrationMl: numberOr(raw.hydrationMl),
    time: typeof raw.time === "string" ? raw.time : "現在",
    notes: textOrNull(raw.notes),
    ...(typeof raw.source === "string" ? { source: raw.source } : {}),
    ...(typeof raw.confidence === "string" ? { confidence: raw.confidence } : {}),
    ...(typeof raw.sourceFoodId === "string" ? { sourceFoodId: raw.sourceFoodId } : {}),
  };
}

export const totalForEntry = (entry: FoodEntry): Nutrition => {
  const servings = Math.max(numberOr(entry.servings, 1), 0) * Math.min(100, Math.max(0, numberOr(entry.consumedPercent, 100))) / 100;
  const value = (nutrition: number | null) => nutrition === null ? 0 : numberOr(nutrition) * servings;
  return { caloriesKcal: value(entry.caloriesKcal), proteinG: value(entry.proteinG), carbsG: value(entry.carbsG), fatG: value(entry.fatG), fiberG: value(entry.fiberG), sugarG: value(entry.sugarG), saturatedFatG: value(entry.saturatedFatG), transFatG: value(entry.transFatG), sodiumMg: value(entry.sodiumMg), potassiumMg: value(entry.potassiumMg), cholesterolMg: value(entry.cholesterolMg), caffeineMg: value(entry.caffeineMg) };
};

export const calculateDailyNutrition = (entries: FoodEntry[]): Nutrition => entries.reduce<Nutrition>((total, entry) => {
  const value = totalForEntry(entry);
  return {
    caloriesKcal: total.caloriesKcal + value.caloriesKcal, proteinG: total.proteinG + value.proteinG, carbsG: total.carbsG + value.carbsG, fatG: total.fatG + value.fatG,
    fiberG: total.fiberG + value.fiberG, sugarG: total.sugarG + value.sugarG, saturatedFatG: total.saturatedFatG + value.saturatedFatG, transFatG: (total.transFatG ?? 0) + (value.transFatG ?? 0),
    sodiumMg: total.sodiumMg + value.sodiumMg, potassiumMg: (total.potassiumMg ?? 0) + (value.potassiumMg ?? 0), cholesterolMg: (total.cholesterolMg ?? 0) + (value.cholesterolMg ?? 0), caffeineMg: total.caffeineMg + value.caffeineMg,
  };
}, emptyNutrition());

/** Splits a day's tracked water into plain water and food/drink hydration. */
export const calculateHydrationSummary = (entries: FoodEntry[], waterMl: number): HydrationSummary => {
  const totalWaterMl = numberOr(waterMl);
  const recordedDrinkWater = entries.reduce((total, entry) => total + numberOr(entry.hydrationMl), 0);
  // Older entries may have hydration recorded before it was included in daily water.
  // Keep the displayed parts consistent with the stored daily total.
  const beverageWaterMl = Math.min(totalWaterMl, recordedDrinkWater);
  return { totalWaterMl, beverageWaterMl, plainWaterMl: Math.max(0, totalWaterMl - beverageWaterMl) };
};

export const calculateDailyTotals = calculateDailyNutrition;
export const calculateNutritionByPortion = (nutrition: Nutrition, servings: number): Nutrition => totalForEntry({ id: "calculation", name: "calculation", brand: null, category: null, mealType: "其他", servings, consumedPercent: 100, servingWeightG: null, hydrationMl: 0, time: "", notes: null, ...nutrition });
export const formatNutrition = (value: number | null | undefined, unit: "g" | "mg" | "kcal") => `${unit === "g" ? Math.round((value ?? 0) * 10) / 10 : Math.round(value ?? 0)} ${unit}`;
export const parseNonNegativeNumber = (value: string): number | null => { if (value.trim() === "") return null; const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; };
export const calculateRemainingCalories = (goal: number, consumed: number) => goal - consumed;
export const calculateSevenDayAverage = (weights: (number | null)[]) => { const values = weights.filter((weight): weight is number => weight !== null && Number.isFinite(weight)); return values.length ? Math.round(values.reduce((sum, weight) => sum + weight, 0) / values.length * 10) / 10 : null; };
export const formatLocalDate = (date: Date, timeZone = "Asia/Taipei") => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
export const getWeekRange = (date: Date) => { const current = new Date(date); current.setDate(current.getDate() - ((current.getDay() + 6) % 7)); const end = new Date(current); end.setDate(current.getDate() + 6); return { start: formatLocalDate(current), end: formatLocalDate(end) }; };
