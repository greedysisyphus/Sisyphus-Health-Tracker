import { z } from "zod";
import { isDrinkCategory, meals, type FoodEntry } from "./nutrition";

const exportNutrition = z.object({
  calories_kcal: z.number().min(0).optional(),
  protein_g: z.number().min(0).optional(),
  fat_g: z.number().min(0).optional(),
  carbohydrate_g: z.number().min(0).optional(),
  sugar_g: z.number().min(0).optional(),
  fiber_g: z.number().min(0).optional(),
  saturated_fat_g: z.number().min(0).optional(),
  trans_fat_g: z.number().min(0).nullable().optional(),
  sodium_mg: z.number().min(0).optional(),
  potassium_mg: z.number().min(0).nullable().optional(),
  cholesterol_mg: z.number().min(0).nullable().optional(),
  caffeine_mg: z.number().min(0).nullable().optional(),
  estimated: z.boolean().optional(),
}).passthrough();

const exportItem = z.object({
  name: z.string().trim().min(1),
  quantity: z.union([z.number().positive(), z.string().trim().min(1)]).optional(),
  weight_g: z.number().positive().optional(),
  volume_ml: z.number().positive().optional(),
  note: z.string().max(1000).optional(),
  nutrition: exportNutrition,
}).passthrough();

const exportDay = z.object({
  date: z.string().date(),
  weight_kg: z.number().positive().nullable().optional(),
  water_ml: z.number().min(0).nullable().optional(),
  steps: z.number().int().min(0).nullable().optional(),
  steps_note: z.string().max(1000).optional(),
  meals: z.array(z.object({ meal: z.string().min(1), items: z.array(exportItem) }).passthrough()).default([]),
  beverages: z.array(exportItem).default([]),
}).passthrough();

export const historyExportSchema = z.object({
  schema_version: z.literal("3.0"),
  exported_at: z.string().datetime({ offset: true }),
  timezone: z.string().min(1),
  profile: z.record(z.string(), z.unknown()).optional(),
  targets: z.record(z.string(), z.unknown()).optional(),
  date_range: z.object({ start: z.string().date(), end: z.string().date() }).strict(),
  daily_records: z.array(exportDay).min(1),
}).passthrough().superRefine((value, context) => {
  if (value.date_range.start > value.date_range.end) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["date_range"], message: "start must not be after end" });
  }
  const dates = value.daily_records.map(record => record.date);
  if (new Set(dates).size !== dates.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["daily_records"], message: "daily records must contain unique dates" });
  }
  if (dates.some(date => date < value.date_range.start || date > value.date_range.end)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["daily_records"], message: "daily records must be inside date range" });
  }
});

export type HistoryExport = z.infer<typeof historyExportSchema>;
export type HistoryExportDay = HistoryExport["daily_records"][number];

export type HistoryExportPreview = {
  startDate: string;
  endDate: string;
  dayCount: number;
  entryCount: number;
  beverageCount: number;
  waterDayCount: number;
  bodyMetricDayCount: number;
};

export type HistoryExportValidation =
  | { ok: true; data: HistoryExport; preview: HistoryExportPreview }
  | { ok: false; error: string };

export type HistoryExportDayInput = {
  date: string;
  waterMl?: number | null;
  weightKg?: number | null;
  steps?: number | null;
  entries: FoodEntry[];
};

/** Map one loaded day (with entries) into the schema 3.0 export day shape. */
export function buildHistoryExportDay(day: HistoryExportDayInput): HistoryExportDay {
  const toExportItem = (entry: FoodEntry) => ({
    name: entry.name,
    quantity: entry.servings,
    weight_g: entry.servingWeightG ?? undefined,
    volume_ml: entry.hydrationMl || undefined,
    note: entry.notes ?? undefined,
    nutrition: {
      calories_kcal: entry.caloriesKcal,
      protein_g: entry.proteinG,
      fat_g: entry.fatG,
      carbohydrate_g: entry.carbsG,
      sugar_g: entry.sugarG,
      fiber_g: entry.fiberG,
      saturated_fat_g: entry.saturatedFatG,
      trans_fat_g: entry.transFatG,
      sodium_mg: entry.sodiumMg,
      potassium_mg: entry.potassiumMg,
      cholesterol_mg: entry.cholesterolMg,
      caffeine_mg: entry.caffeineMg,
      estimated: entry.confidence !== "high",
    },
  });
  const isBeverage = (entry: FoodEntry) => entry.mealType === "飲料" || isDrinkCategory(entry.category, entry.hydrationMl, entry.name);
  const beverages = day.entries.filter(isBeverage).map(toExportItem);
  const mealEntries = day.entries.filter(entry => !isBeverage(entry));
  const mealGroups = meals
    .map(meal => ({ meal, items: mealEntries.filter(entry => entry.mealType === meal).map(toExportItem) }))
    .filter(group => group.items.length);
  return {
    date: day.date,
    weight_kg: day.weightKg ?? null,
    water_ml: day.waterMl ?? null,
    steps: day.steps ?? null,
    meals: mealGroups,
    beverages,
  };
}

export function validateHistoryExport(value: unknown): HistoryExportValidation {
  const parsed = historyExportSchema.safeParse(value);
  if (!parsed.success) return { ok: false, error: "JSON 格式或版本不支援，請選擇 schema_version 3.0 的匯出檔。" };

  const data = parsed.data;
  return {
    ok: true,
    data,
    preview: {
      startDate: data.date_range.start,
      endDate: data.date_range.end,
      dayCount: data.daily_records.length,
      entryCount: data.daily_records.reduce((total, day) => total + day.meals.reduce((sum, meal) => sum + meal.items.length, 0), 0),
      beverageCount: data.daily_records.reduce((total, day) => total + day.beverages.length, 0),
      waterDayCount: data.daily_records.filter(day => day.water_ml !== null && day.water_ml !== undefined).length,
      bodyMetricDayCount: data.daily_records.filter(day => (day.weight_kg !== null && day.weight_kg !== undefined) || (day.steps !== null && day.steps !== undefined)).length,
    },
  };
}
