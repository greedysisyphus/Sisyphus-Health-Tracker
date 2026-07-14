import { createHmac, timingSafeEqual } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";

const nutrition = z.object({ calories: z.number().min(0), protein: z.number().min(0), carbs: z.number().min(0), fat: z.number().min(0), sugar: z.number().min(0).default(0), fiber: z.number().min(0).default(0), saturatedFat: z.number().min(0).default(0), sodium: z.number().min(0).default(0) });
const foodEntry = z.object({ id: z.string().min(1).optional(), name: z.string().min(1), meal: z.enum(["早餐", "午餐", "晚餐", "點心", "飲料", "其他"]), nutrition, portion: z.number().positive().default(1), unit: z.string().min(1).default("份"), time: z.string().default("現在"), source: z.enum(["nutrition_label", "restaurant_official", "ingredient_calculation", "database", "ai_estimated", "manual_estimated"]).default("ai_estimated"), confidence: z.enum(["high", "medium", "low"]).default("medium"), notes: z.string().max(1000).optional() });
const importedFood = z.object({
  name: z.string().min(1), quantity: z.union([z.number(), z.string()]).optional(), volume_ml: z.number().positive().optional(), calories: z.number().min(0).optional(), estimated_calories: z.number().min(0).optional(), protein_g: z.number().min(0).optional(), carbs_g: z.number().min(0).optional(), fat_g: z.number().min(0).optional(), sodium_mg: z.number().min(0).optional(), note: z.string().max(1000).optional(), restaurant: z.string().max(200).optional(), include: z.array(z.string().max(200)).optional(),
}).passthrough();
const importedCoffee = z.object({ type: z.string().min(1), count: z.number().positive().optional(), volume_ml: z.number().positive().optional(), description: z.string().max(500).optional() }).passthrough();
const importPayload = z.object({
  user: z.object({ height_cm: z.number().positive().optional(), weight: z.record(z.string().date(), z.number().positive()).optional(), goal_weight_kg: z.number().positive().optional(), daily_steps_avg: z.number().int().min(0).optional() }).optional(),
  nutrition_target: z.object({ calories: z.object({ fat_loss: z.string().optional() }).optional(), protein_g: z.string().optional(), water_ml: z.string().optional() }).optional(),
  health_goals: z.record(z.string(), z.boolean()).optional(),
  analysis: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  records: z.array(z.object({ date: z.string().date(), water_ml: z.number().min(0).optional(), weight_kg: z.number().positive().optional(), steps: z.number().int().min(0).optional(), foods: z.array(importedFood).default([]), coffee: z.array(importedCoffee).default([]) })).min(1),
});
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("log_food"), date: z.string().date(), entries: z.array(foodEntry).min(1) }),
  z.object({ action: z.literal("amend_food"), date: z.string().date(), entryId: z.string().min(1), changes: foodEntry.partial().omit({ id: true }).refine(value => Object.keys(value).length > 0) }),
  z.object({ action: z.literal("delete_food"), date: z.string().date(), entryId: z.string().min(1) }),
  z.object({ action: z.literal("upsert_food"), food: z.object({ id: z.string().min(1).optional(), name: z.string().min(1), brand: z.string().optional(), category: z.string().min(1), baseAmount: z.number().positive(), unit: z.string().min(1), nutrition, favorite: z.boolean().default(false), notes: z.string().max(1000).optional() }) }),
  z.object({ action: z.literal("log_water"), date: z.string().date(), addMl: z.number().positive().max(10000) }),
  z.object({ action: z.literal("log_body"), date: z.string().date(), weightKg: z.number().positive().max(500).optional(), waistCm: z.number().positive().max(300).optional(), bodyFatPercent: z.number().min(0).max(100).optional(), sleepHours: z.number().min(0).max(24).optional(), steps: z.number().int().min(0).max(100000).optional(), note: z.string().max(1000).optional() }).refine(value => Object.keys(value).some(key => !["action", "date"].includes(key))),
  z.object({ action: z.literal("get_daily_summary"), date: z.string().date() }),
  z.object({ action: z.literal("import_history"), data: importPayload }),
  z.object({ action: z.literal("shift_imported_history"), dates: z.array(z.string().date()).min(1), waterDates: z.array(z.string().date()).default([]), bodyDates: z.array(z.string().date()).default([]), days: z.number().int().min(-365).max(365), preserveSourceDates: z.array(z.string().date()).default([]) }),
]);

function verifyRequest(raw: string, request: Request) {
  const secret = process.env.HERMES_API_SECRET;
  const timestamp = request.headers.get("x-health-timestamp");
  const signature = request.headers.get("x-health-signature");
  if (!secret || !timestamp || !signature) return false;
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60_000) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  try { return timingSafeEqual(Buffer.from(expected), Buffer.from(signature)); } catch { return false; }
}

const dayRef = (db: FirebaseFirestore.Firestore, ownerId: string, date: string) => db.doc(`users/${ownerId}/dailyLogs/${date}`);
const entryRef = (db: FirebaseFirestore.Firestore, ownerId: string, date: string, entryId: string) => dayRef(db, ownerId, date).collection("entries").doc(entryId);
const emptyNutrition = { calories: 0, protein: 0, carbs: 0, fat: 0, sugar: 0, fiber: 0, saturatedFat: 0, sodium: 0 };
const importedNotes = (food: z.infer<typeof importedFood>) => [food.note, food.restaurant ? `餐廳：${food.restaurant}` : undefined, food.include?.length ? `包含：${food.include.join("、")}` : undefined].filter(Boolean).join("；") || undefined;
const shiftDate = (date: string, days: number) => new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyRequest(raw, request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
  const ownerId = process.env.HEALTH_TRACKER_OWNER_ID;
  if (!ownerId) return Response.json({ error: "server_not_configured" }, { status: 500 });
  const db = getAdminDb();
  const input = parsed.data;
  const now = FieldValue.serverTimestamp();
  try {
    if (input.action === "log_food") {
      const batch = db.batch();
      batch.set(dayRef(db, ownerId, input.date), { date: input.date, updatedAt: now, createdAt: now }, { merge: true });
      const entries = input.entries.map(item => {
        const id = item.id ?? crypto.randomUUID();
        const nutrition = item.nutrition;
        const entry = { id, name: item.name, meal: item.meal, calories: nutrition.calories * item.portion, protein: nutrition.protein * item.portion, carbs: nutrition.carbs * item.portion, fat: nutrition.fat * item.portion, sugar: nutrition.sugar * item.portion, fiber: nutrition.fiber * item.portion, saturatedFat: nutrition.saturatedFat * item.portion, sodium: nutrition.sodium * item.portion, portion: item.portion, unit: item.unit, time: item.time, source: item.source, confidence: item.confidence, notes: item.notes, createdAt: now, updatedAt: now };
        batch.set(entryRef(db, ownerId, input.date, id), entry, { merge: true });
        return entry;
      });
      await batch.commit();
      return Response.json({ ok: true, action: input.action, entries });
    }
    if (input.action === "amend_food") {
      await entryRef(db, ownerId, input.date, input.entryId).set({ ...input.changes, updatedAt: now }, { merge: true });
      return Response.json({ ok: true, action: input.action, entryId: input.entryId });
    }
    if (input.action === "delete_food") {
      await entryRef(db, ownerId, input.date, input.entryId).delete();
      return Response.json({ ok: true, action: input.action, entryId: input.entryId });
    }
    if (input.action === "upsert_food") {
      const id = input.food.id ?? crypto.randomUUID();
      await db.doc(`users/${ownerId}/foods/${id}`).set({ ...input.food, id, useCount: 0, createdAt: now, updatedAt: now }, { merge: true });
      return Response.json({ ok: true, action: input.action, foodId: id });
    }
    if (input.action === "log_water") {
      await dayRef(db, ownerId, input.date).set({ date: input.date, waterMl: FieldValue.increment(input.addMl), updatedAt: now, createdAt: now }, { merge: true });
      return Response.json({ ok: true, action: input.action, addMl: input.addMl });
    }
    if (input.action === "log_body") {
      const body = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "action"));
      await db.doc(`users/${ownerId}/bodyLogs/${input.date}`).set({ ...body, updatedAt: now, createdAt: now }, { merge: true });
      await dayRef(db, ownerId, input.date).set({ date: input.date, ...(input.weightKg !== undefined ? { weightKg: input.weightKg } : {}), ...(input.steps !== undefined ? { steps: input.steps } : {}), ...(input.sleepHours !== undefined ? { sleepHours: input.sleepHours } : {}), updatedAt: now, createdAt: now }, { merge: true });
      return Response.json({ ok: true, action: input.action });
    }
    if (input.action === "import_history") {
      const batch = db.batch();
      const imported = input.data;
      const profile = {
        heightCm: imported.user?.height_cm,
        targetWeightKg: imported.user?.goal_weight_kg,
        dailyStepsAverage: imported.user?.daily_steps_avg,
        nutritionTarget: imported.nutrition_target,
        healthGoals: imported.health_goals,
        analysis: imported.analysis,
        updatedAt: now,
        createdAt: now,
      };
      batch.set(db.doc(`users/${ownerId}`), profile, { merge: true });
      let foodCount = 0;
      for (const record of imported.records) {
        const dailyData: Record<string, unknown> = { date: record.date, updatedAt: now, createdAt: now };
        if (record.water_ml !== undefined) dailyData.waterMl = record.water_ml;
        const weightKg = record.weight_kg ?? imported.user?.weight?.[record.date];
        if (weightKg !== undefined) dailyData.weightKg = weightKg;
        if (record.steps !== undefined) dailyData.steps = record.steps;
        batch.set(dayRef(db, ownerId, record.date), dailyData, { merge: true });
        if (weightKg !== undefined || record.steps !== undefined) batch.set(db.doc(`users/${ownerId}/bodyLogs/${record.date}`), { date: record.date, ...(weightKg !== undefined ? { weightKg } : {}), ...(record.steps !== undefined ? { steps: record.steps } : {}), updatedAt: now, createdAt: now }, { merge: true });
        const importedItems = [
          ...record.foods.map((food, index) => ({
            id: `historic-food-${record.date}-${index}`,
            name: food.name,
            meal: "其他" as const,
            calories: food.calories ?? food.estimated_calories ?? 0,
            protein: food.protein_g ?? 0,
            carbs: food.carbs_g ?? 0,
            fat: food.fat_g ?? 0,
            sodium: food.sodium_mg ?? 0,
            portion: food.volume_ml ?? (typeof food.quantity === "number" ? food.quantity : 1),
            unit: food.volume_ml ? "ml" : typeof food.quantity === "string" ? food.quantity : "份",
            notes: importedNotes(food),
          })),
          ...record.coffee.map((coffee, index) => ({
            id: `historic-coffee-${record.date}-${index}`,
            name: coffee.description ?? `${coffee.type}${coffee.count ? ` ×${coffee.count}` : coffee.volume_ml ? ` ${coffee.volume_ml} ml` : ""}`,
            meal: "飲料" as const,
            ...emptyNutrition,
            portion: coffee.count ?? 1,
            unit: coffee.volume_ml ? "ml" : "杯",
            notes: coffee.description ? `咖啡／飲品紀錄：${coffee.type}` : undefined,
          })),
        ];
        for (const item of importedItems) {
          const { id, notes, ...entry } = item;
          batch.set(entryRef(db, ownerId, record.date, id), { id, ...emptyNutrition, ...entry, source: "manual_estimated", confidence: entry.calories > 0 || entry.protein > 0 ? "medium" : "low", time: "歷史匯入", ...(notes ? { notes } : {}), createdAt: now, updatedAt: now }, { merge: true });
          foodCount += 1;
        }
      }
      await batch.commit();
      return Response.json({ ok: true, action: input.action, importedDays: imported.records.length, importedEntries: foodCount });
    }
    if (input.action === "shift_imported_history") {
      const batch = db.batch();
      let movedEntries = 0;
      for (const sourceDate of input.dates) {
        const targetDate = shiftDate(sourceDate, input.days);
        batch.set(dayRef(db, ownerId, targetDate), { date: targetDate, updatedAt: now, createdAt: now }, { merge: true });
        const sourceEntries = await dayRef(db, ownerId, sourceDate).collection("entries").get();
        for (const document of sourceEntries.docs) {
          if (!document.id.startsWith("historic-")) continue;
          const data = document.data();
          const id = document.id.replace(sourceDate, targetDate);
          batch.set(entryRef(db, ownerId, targetDate, id), { ...data, id, updatedAt: now }, { merge: true });
          batch.delete(document.ref);
          movedEntries += 1;
        }
        if (input.waterDates.includes(sourceDate)) {
          const source = await dayRef(db, ownerId, sourceDate).get();
          const waterMl = source.data()?.waterMl;
          if (typeof waterMl === "number") {
            batch.set(dayRef(db, ownerId, targetDate), { date: targetDate, waterMl, updatedAt: now, createdAt: now }, { merge: true });
            batch.set(dayRef(db, ownerId, sourceDate), { waterMl: FieldValue.delete(), updatedAt: now }, { merge: true });
          }
        }
        if (input.bodyDates.includes(sourceDate)) {
          const sourceBody = await db.doc(`users/${ownerId}/bodyLogs/${sourceDate}`).get();
          if (sourceBody.exists) {
            const body = sourceBody.data() ?? {};
            const values = Object.fromEntries(Object.entries(body).filter(([key]) => !["date", "createdAt", "updatedAt"].includes(key)));
            batch.set(db.doc(`users/${ownerId}/bodyLogs/${targetDate}`), { ...values, date: targetDate, updatedAt: now, createdAt: now }, { merge: true });
            batch.set(dayRef(db, ownerId, targetDate), { date: targetDate, ...(typeof values.weightKg === "number" ? { weightKg: values.weightKg } : {}), ...(typeof values.steps === "number" ? { steps: values.steps } : {}), ...(typeof values.sleepHours === "number" ? { sleepHours: values.sleepHours } : {}), updatedAt: now, createdAt: now }, { merge: true });
            batch.delete(sourceBody.ref);
            batch.set(dayRef(db, ownerId, sourceDate), { weightKg: FieldValue.delete(), steps: FieldValue.delete(), sleepHours: FieldValue.delete(), updatedAt: now }, { merge: true });
          }
        }
        if (!input.preserveSourceDates.includes(sourceDate)) batch.delete(dayRef(db, ownerId, sourceDate));
      }
      await batch.commit();
      return Response.json({ ok: true, action: input.action, movedEntries, movedDays: input.dates.length });
    }
    const entries = await dayRef(db, ownerId, input.date).collection("entries").get();
    const total = entries.docs.reduce((sum, document) => {
      const data = document.data();
      for (const key of ["calories", "protein", "carbs", "fat", "sugar", "fiber", "saturatedFat", "sodium"] as const) sum[key] += Number(data[key] ?? 0);
      return sum;
    }, { calories: 0, protein: 0, carbs: 0, fat: 0, sugar: 0, fiber: 0, saturatedFat: 0, sodium: 0 });
    const daily = await dayRef(db, ownerId, input.date).get();
    return Response.json({ ok: true, action: input.action, date: input.date, total, waterMl: daily.data()?.waterMl ?? 0, entries: entries.docs.map(document => document.data()) });
  } catch (error) {
    console.error("Hermes health API failed", error);
    return Response.json({ error: "operation_failed" }, { status: 500 });
  }
}
