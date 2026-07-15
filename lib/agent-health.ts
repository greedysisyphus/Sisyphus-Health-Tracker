import { createHash } from "crypto";

export type NutritionInput = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  sugar?: number;
  saturatedFat?: number;
  transFat?: number | null;
  sodium?: number;
  potassium?: number | null;
  cholesterol?: number | null;
  caffeine?: number;
};

export type HealthEventFoodInput = {
  id?: string;
  name: string;
  brand?: string | null;
  category?: string | null;
  meal: "早餐" | "午餐" | "晚餐" | "點心" | "飲料" | "宵夜" | "其他";
  nutrition: NutritionInput;
  servings?: number;
  servingWeightG?: number | null;
  hydrationMl?: number;
  time?: string;
  source?: string;
  confidence?: string;
  notes?: string | null;
};

type CanonicalEntry = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  mealType: HealthEventFoodInput["meal"];
  servings: number;
  servingWeightG: number | null;
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
  hydrationMl: number;
  time: string;
  source: string;
  confidence: string;
  notes: string | null;
};

export type NutritionTotal = {
  caloriesKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sugarG: number;
  saturatedFatG: number;
  transFatG: number;
  sodiumMg: number;
  potassiumMg: number;
  cholesterolMg: number;
  caffeineMg: number;
};

const emptyTotal = (): NutritionTotal => ({
  caloriesKcal: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  fiberG: 0,
  sugarG: 0,
  saturatedFatG: 0,
  transFatG: 0,
  sodiumMg: 0,
  potassiumMg: 0,
  cholesterolMg: 0,
  caffeineMg: 0,
});

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
};

export function canonicalPayloadHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(payload))).digest("hex");
}

export function idempotencyDocumentId(input: { source: string; eventId: string; operationKey: string }): string {
  return createHash("sha256")
    .update(JSON.stringify([input.source, input.eventId, input.operationKey]))
    .digest("hex");
}

export function nextWaterMl(
  currentWaterMl: number,
  oldHydrationMl: number,
  newHydrationMl: number,
  totalHydrationBeforeMl: number,
): number {
  const hydrationDeltaMl = newHydrationMl - oldHydrationMl;
  const safeDeltaMl = currentWaterMl < totalHydrationBeforeMl
    ? Math.max(0, hydrationDeltaMl)
    : hydrationDeltaMl;
  return Math.max(0, currentWaterMl + safeDeltaMl);
}

export function resolveIdempotency(
  existing: { payloadHash: string; response: Record<string, unknown> } | null,
  payloadHash: string,
): { kind: "new" } | { kind: "replay"; response: Record<string, unknown> } {
  if (!existing) return { kind: "new" };
  if (existing.payloadHash !== payloadHash) throw new Error("idempotency_conflict");
  return { kind: "replay", response: { ...existing.response, replayed: true } };
}

const amendAllowlist = {
  standard: new Set(["nutrition", "servings", "servingWeightG", "source", "confidence", "notes", "hydrationMl"]),
  history_backfill: new Set(["nutrition", "source", "confidence", "notes"]),
};

export function assertAllowedAmendChanges(
  changes: Record<string, unknown>,
  mode: "standard" | "history_backfill" = "standard",
): void {
  for (const key of Object.keys(changes)) {
    if (!amendAllowlist[mode].has(key)) throw new Error(`disallowed_amend_field:${key}`);
  }
}

const safeNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

export function totalForEntryData(entries: Array<Record<string, unknown>>): NutritionTotal {
  return entries.reduce<NutritionTotal>((total, entry) => {
    const canonical = entry.caloriesKcal !== undefined;
    const servings = canonical ? safeNumber(entry.servings || 1) : 1;
    const add = (canonicalKey: string, legacyKey: string) =>
      safeNumber(canonical ? entry[canonicalKey] : entry[legacyKey]) * servings;
    total.caloriesKcal += add("caloriesKcal", "calories");
    total.proteinG += add("proteinG", "protein");
    total.carbsG += add("carbsG", "carbs");
    total.fatG += add("fatG", "fat");
    total.fiberG += add("fiberG", "fiber");
    total.sugarG += add("sugarG", "sugar");
    total.saturatedFatG += add("saturatedFatG", "saturatedFat");
    total.transFatG += add("transFatG", "transFat");
    total.sodiumMg += add("sodiumMg", "sodium");
    total.potassiumMg += add("potassiumMg", "potassium");
    total.cholesterolMg += add("cholesterolMg", "cholesterol");
    total.caffeineMg += add("caffeineMg", "caffeine");
    return total;
  }, emptyTotal());
}

export function canonicalizeFoodEntry(item: HealthEventFoodInput, id: string): CanonicalEntry {
  const nutrition = item.nutrition;
  return {
    id,
    name: item.name,
    brand: item.brand ?? null,
    category: item.category ?? null,
    mealType: item.meal,
    servings: item.servings ?? 1,
    servingWeightG: item.servingWeightG ?? null,
    caloriesKcal: nutrition.calories,
    proteinG: nutrition.protein,
    carbsG: nutrition.carbs,
    fatG: nutrition.fat,
    fiberG: nutrition.fiber ?? 0,
    sugarG: nutrition.sugar ?? 0,
    saturatedFatG: nutrition.saturatedFat ?? 0,
    transFatG: nutrition.transFat ?? null,
    sodiumMg: nutrition.sodium ?? 0,
    potassiumMg: nutrition.potassium ?? null,
    cholesterolMg: nutrition.cholesterol ?? null,
    caffeineMg: nutrition.caffeine ?? 0,
    hydrationMl: item.hydrationMl ?? 0,
    time: item.time ?? "現在",
    source: item.source ?? "ai_estimated",
    confidence: item.confidence ?? "medium",
    notes: item.notes ?? null,
  };
}

export function buildHealthEventPlan(input: {
  date: string;
  entries: HealthEventFoodInput[];
  plainWaterMl: number;
  currentWaterMl: number;
  currentEntries: Array<Record<string, unknown>>;
  createId?: () => string;
}) {
  const createId = input.createId ?? (() => crypto.randomUUID());
  const entries = input.entries.map(item => canonicalizeFoodEntry(item, item.id ?? createId()));
  const hydrationMl = entries.reduce((total, entry) => total + entry.hydrationMl, 0);
  const waterMl = input.currentWaterMl + input.plainWaterMl + hydrationMl;
  const total = totalForEntryData([...input.currentEntries, ...entries]);
  return { entries, waterMl, dailySummary: { ...total, waterMl } };
}
