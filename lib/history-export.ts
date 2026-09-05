import { z } from "zod";

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
