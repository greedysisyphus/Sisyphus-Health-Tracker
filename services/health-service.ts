import { collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { calculateDailyNutrition, emptyNutrition, normalizeFoodRecord, type FoodEntry, type Nutrition } from "../lib/nutrition";
import type { BodyLog, DailyLog } from "../types/models";

const dailyPath = (userId: string, date: string) => `users/${userId}/dailyLogs/${date}`;

export type DailyOverview = { date: string; waterMl: number; entries: FoodEntry[]; total: Nutrition; weightKg?: number; steps?: number };
export type BodyLogSummary = { date: string; weightKg?: number; steps?: number; sleepHours?: number };

export async function listDailyEntries(userId: string, date: string): Promise<FoodEntry[]> {
  if (!db) return [];
  const snapshot = await getDocs(collection(db, dailyPath(userId, date), "entries"));
  return snapshot.docs.map(item => normalizeFoodRecord(item.data(), item.id)).sort((a, b) => a.time.localeCompare(b.time));
}

export async function saveEntry(userId: string, date: string, entry: FoodEntry): Promise<void> {
  if (!db) throw new Error("Firebase 尚未設定");
  const dayRef = doc(db, dailyPath(userId, date));
  await setDoc(dayRef, { date, updatedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
  await setDoc(doc(db, dailyPath(userId, date), "entries", entry.id), { ...entry, updatedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
}

export async function removeEntry(userId: string, date: string, entryId: string): Promise<void> {
  if (!db) throw new Error("Firebase 尚未設定");
  await deleteDoc(doc(db, dailyPath(userId, date), "entries", entryId));
}

export async function getDailyLog(userId: string, date: string): Promise<DailyLog | null> {
  if (!db) return null;
  const snapshot = await getDoc(doc(db, dailyPath(userId, date)));
  return snapshot.exists() ? snapshot.data() as DailyLog : null;
}

export async function saveWater(userId: string, date: string, waterMl: number): Promise<void> {
  if (!db) throw new Error("Firebase 尚未設定");
  await setDoc(doc(db, dailyPath(userId, date)), { date, waterMl, updatedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
}

export async function getBodyLog(userId: string, date: string): Promise<BodyLog | null> {
  if (!db) return null;
  const snapshot = await getDoc(doc(db, `users/${userId}/bodyLogs/${date}`));
  return snapshot.exists() ? snapshot.data() as BodyLog : null;
}

export async function getUserProfile(userId: string): Promise<Record<string, unknown> | null> {
  if (!db) return null;
  const snapshot = await getDoc(doc(db, `users/${userId}`));
  return snapshot.exists() ? snapshot.data() : null;
}

export async function saveBodyLog(userId: string, bodyLog: Omit<BodyLog, "createdAt" | "updatedAt">): Promise<void> {
  if (!db) throw new Error("Firebase 尚未設定");
  await setDoc(doc(db, `users/${userId}/bodyLogs/${bodyLog.date}`), { ...bodyLog, updatedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
}

/** Latest body logs, including weight-only days that may not have a dailyLog. */
export async function listBodyLogs(userId: string, count = 120): Promise<BodyLogSummary[]> {
  if (!db) return [];
  const snapshot = await getDocs(query(collection(db, `users/${userId}/bodyLogs`), orderBy("date", "desc"), limit(count)));
  return snapshot.docs.map(item => {
    const data = item.data() as BodyLog;
    return {
      date: typeof data.date === "string" ? data.date : item.id,
      ...(typeof data.weightKg === "number" ? { weightKg: data.weightKg } : {}),
      ...(typeof data.steps === "number" ? { steps: data.steps } : {}),
      ...(typeof data.sleepHours === "number" ? { sleepHours: data.sleepHours } : {}),
    };
  });
}

/**
 * Merge dailyLogs with bodyLogs so sparse weight entries still appear in trends
 * even when that calendar day has no food or water log.
 */
export async function listDailyOverviews(userId: string, count = 30): Promise<DailyOverview[]> {
  if (!db) return [];
  const bodyLimit = Math.max(count, 120);
  const [daily, bodies] = await Promise.all([
    getDocs(query(collection(db, `users/${userId}/dailyLogs`), orderBy("date", "desc"), limit(count))),
    listBodyLogs(userId, bodyLimit),
  ]);
  const bodyByDate = new Map(bodies.map(body => [body.date, body]));
  const overviewByDate = new Map<string, DailyOverview>();

  await Promise.all(daily.docs.map(async item => {
    const data = item.data() as DailyLog;
    const entries = await listDailyEntries(userId, data.date);
    const body = bodyByDate.get(data.date);
    overviewByDate.set(data.date, {
      date: data.date,
      waterMl: data.waterMl ?? 0,
      entries,
      total: calculateDailyNutrition(entries),
      weightKg: body?.weightKg ?? data.weightKg,
      steps: body?.steps ?? data.steps,
    });
  }));

  for (const body of bodies) {
    if (overviewByDate.has(body.date)) continue;
    if (body.weightKg === undefined && body.steps === undefined) continue;
    overviewByDate.set(body.date, {
      date: body.date,
      waterMl: 0,
      entries: [],
      total: emptyNutrition(),
      weightKg: body.weightKg,
      steps: body.steps,
    });
  }

  return [...overviewByDate.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, bodyLimit);
}

export type SavedFoodSummary = { id: string; name: string; brand: string | null; category: string | null; servingWeightG: number | null; nutrition: Nutrition; favorite?: boolean; notes: string | null };
export type SavedFoodInput = SavedFoodSummary;

export async function listFoods(userId: string): Promise<SavedFoodSummary[]> {
  if (!db) return [];
  const snapshot = await getDocs(query(collection(db, `users/${userId}/foods`), orderBy("name"), limit(100)));
  return snapshot.docs.map(item => {
    const data = item.data();
    const nestedNutrition = data.nutrition && typeof data.nutrition === "object" ? data.nutrition as Record<string, unknown> : {};
    const normalized = normalizeFoodRecord({ ...data, ...nestedNutrition, id: item.id, mealType: "其他", servings: 1, servingWeightG: data.servingWeightG ?? data.baseAmount, notes: data.notes ?? null }, item.id);
    return { id: item.id, name: normalized.name, brand: normalized.brand, category: normalized.category, servingWeightG: normalized.servingWeightG, nutrition: { caloriesKcal: normalized.caloriesKcal, proteinG: normalized.proteinG, carbsG: normalized.carbsG, fatG: normalized.fatG, fiberG: normalized.fiberG, sugarG: normalized.sugarG, saturatedFatG: normalized.saturatedFatG, transFatG: normalized.transFatG, sodiumMg: normalized.sodiumMg, potassiumMg: normalized.potassiumMg, cholesterolMg: normalized.cholesterolMg, caffeineMg: normalized.caffeineMg }, favorite: Boolean(data.favorite), notes: normalized.notes };
  });
}

export async function saveSavedFood(userId: string, food: SavedFoodInput): Promise<void> {
  if (!db) throw new Error("Firebase 尚未設定");
  await setDoc(doc(db, `users/${userId}/foods/${food.id}`), { ...food, useCount: 0, updatedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
}

export async function removeSavedFood(userId: string, foodId: string): Promise<void> {
  if (!db) throw new Error("Firebase 尚未設定");
  await deleteDoc(doc(db, `users/${userId}/foods/${foodId}`));
}
