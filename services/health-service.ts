import { collection, deleteDoc, doc, getDoc, getDocs, increment, limit, orderBy, query, runTransaction, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { calculateDailyNutrition, emptyNutrition, normalizeFoodRecord, type FoodEntry, type Nutrition } from "../lib/nutrition";
import type { BodyLog, DailyLog } from "../types/models";

const dailyPath = (userId: string, date: string) => `users/${userId}/dailyLogs/${date}`;
const hydration = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

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
  const entryDocument = doc(db, dailyPath(userId, date), "entries", entry.id);
  const savedFoodDocument = entry.sourceFoodId ? doc(db, `users/${userId}/foods/${entry.sourceFoodId}`) : null;
  await runTransaction(db, async transaction => {
    const [daily, previous, savedFood] = await Promise.all([transaction.get(dayRef), transaction.get(entryDocument), savedFoodDocument ? transaction.get(savedFoodDocument) : Promise.resolve(null)]);
    const nextWaterMl = Math.max(0, hydration(daily.data()?.waterMl) + hydration(entry.hydrationMl) - hydration(previous.data()?.hydrationMl));
    transaction.set(dayRef, { date, waterMl: nextWaterMl, updatedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
    transaction.set(entryDocument, { ...entry, updatedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
    if (!previous.exists() && savedFood?.exists() && savedFoodDocument) transaction.update(savedFoodDocument, { useCount: increment(1), updatedAt: serverTimestamp() });
  });
}

export async function removeEntry(userId: string, date: string, entryId: string): Promise<void> {
  if (!db) throw new Error("Firebase 尚未設定");
  const dayRef = doc(db, dailyPath(userId, date));
  const entryDocument = doc(db, dailyPath(userId, date), "entries", entryId);
  await runTransaction(db, async transaction => {
    const [daily, entry] = await Promise.all([transaction.get(dayRef), transaction.get(entryDocument)]);
    transaction.set(dayRef, { date, waterMl: Math.max(0, hydration(daily.data()?.waterMl) - hydration(entry.data()?.hydrationMl)), updatedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
    transaction.delete(entryDocument);
  });
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

export async function saveHealthTargets(userId: string, targets: Record<string, number>): Promise<void> {
  if (!db) throw new Error("Firebase 尚未設定");
  await setDoc(doc(db, `users/${userId}`), { ...targets, updatedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
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

export type SavedFoodSummary = { id: string; name: string; brand: string | null; category: string | null; servingWeightG: number | null; hydrationMlPerServing: number; nutrition: Nutrition; favorite?: boolean; useCount: number; notes: string | null };
export type SavedFoodInput = Omit<SavedFoodSummary, "useCount"> & { useCount?: number };

export async function listFoods(userId: string): Promise<SavedFoodSummary[]> {
  if (!db) return [];
  const snapshot = await getDocs(query(collection(db, `users/${userId}/foods`), orderBy("name"), limit(100)));
  return snapshot.docs.map(item => {
    const data = item.data();
    const nestedNutrition = data.nutrition && typeof data.nutrition === "object" ? data.nutrition as Record<string, unknown> : {};
    const normalized = normalizeFoodRecord({ ...data, ...nestedNutrition, id: item.id, mealType: "其他", servings: 1, servingWeightG: data.servingWeightG ?? data.baseAmount, notes: data.notes ?? null }, item.id);
    return { id: item.id, name: normalized.name, brand: normalized.brand, category: normalized.category, servingWeightG: normalized.servingWeightG, hydrationMlPerServing: hydration(data.hydrationMlPerServing), nutrition: { caloriesKcal: normalized.caloriesKcal, proteinG: normalized.proteinG, carbsG: normalized.carbsG, fatG: normalized.fatG, fiberG: normalized.fiberG, sugarG: normalized.sugarG, saturatedFatG: normalized.saturatedFatG, transFatG: normalized.transFatG, sodiumMg: normalized.sodiumMg, potassiumMg: normalized.potassiumMg, cholesterolMg: normalized.cholesterolMg, caffeineMg: normalized.caffeineMg }, favorite: Boolean(data.favorite), useCount: hydration(data.useCount), notes: normalized.notes };
  }).sort((left, right) => right.useCount - left.useCount || left.name.localeCompare(right.name, "zh-Hant"));
}

// Product names are often entered with inconsistent spaces (for example 「光泉 無加糖黑豆漿」).
const comparableFoodText = (value: string | null) => value?.replace(/\s+/g, "").toLocaleLowerCase("zh-TW") ?? "";
const compatibleFoodBrand = (left: string | null, right: string | null) => {
  const leftBrand = comparableFoodText(left);
  const rightBrand = comparableFoodText(right);
  return leftBrand === rightBrand || !leftBrand || !rightBrand;
};

export async function saveSavedFood(userId: string, food: SavedFoodInput): Promise<{ id: string; mergedDuplicate: boolean }> {
  if (!db) throw new Error("Firebase 尚未設定");
  const sameName = (await listFoods(userId)).filter(item => item.id !== food.id && comparableFoodText(item.name) === comparableFoodText(food.name));
  const exactBrand = sameName.find(item => comparableFoodText(item.brand) === comparableFoodText(food.brand));
  const compatible = sameName.filter(item => compatibleFoodBrand(item.brand, food.brand));
  const existing = exactBrand ?? (compatible.length === 1 ? compatible[0] : undefined);
  const id = existing?.id ?? food.id;
  await setDoc(doc(db, `users/${userId}/foods/${id}`), {
    ...food,
    id,
    useCount: Math.max(food.useCount ?? 0, existing?.useCount ?? 0),
    updatedAt: serverTimestamp(),
    ...(existing ? {} : { createdAt: serverTimestamp() }),
  }, { merge: true });
  if (existing) await deleteDoc(doc(db, `users/${userId}/foods/${food.id}`));
  return { id, mergedDuplicate: Boolean(existing) };
}

export async function removeSavedFood(userId: string, foodId: string): Promise<void> {
  if (!db) throw new Error("Firebase 尚未設定");
  await deleteDoc(doc(db, `users/${userId}/foods/${foodId}`));
}

/** Merges a user-confirmed group of same-name, same-brand saved foods. */
export async function mergeSavedFoodDuplicates(userId: string, foodIds: string[]): Promise<{ keptFoodId: string; removedCount: number; name: string }> {
  const firebaseDb = db;
  if (!firebaseDb) throw new Error("Firebase 尚未設定");
  const uniqueIds = [...new Set(foodIds)];
  if (uniqueIds.length < 2) throw new Error("至少需要兩項常用食物才能合併");
  const references = uniqueIds.map(id => doc(firebaseDb, `users/${userId}/foods/${id}`));
  return runTransaction(firebaseDb, async transaction => {
    const snapshots = await Promise.all(references.map(reference => transaction.get(reference)));
    if (snapshots.some(snapshot => !snapshot.exists())) throw new Error("找不到要合併的常用食物");
    const identity = snapshots.map(snapshot => {
      const data = snapshot.data() ?? {};
      return { name: comparableFoodText(String(data.name ?? "")), brand: comparableFoodText(typeof data.brand === "string" ? data.brand : null) };
    });
    const [firstIdentity] = identity;
    const knownBrands = new Set(identity.map(item => item.brand).filter(Boolean));
    if (!firstIdentity || identity.some(item => item.name !== firstIdentity.name) || knownBrands.size > 1) throw new Error("只能合併相同名稱，且品牌不衝突的常用食物");
    const keep = snapshots.reduce((current, candidate) => {
      const currentBrand = comparableFoodText(typeof current.data()?.brand === "string" ? current.data()?.brand : null);
      const candidateBrand = comparableFoodText(typeof candidate.data()?.brand === "string" ? candidate.data()?.brand : null);
      if (candidateBrand && !currentBrand) return candidate;
      if (currentBrand && !candidateBrand) return current;
      const currentCount = hydration(current.data()?.useCount);
      const candidateCount = hydration(candidate.data()?.useCount);
      return candidateCount > currentCount || candidateCount === currentCount && candidate.id.localeCompare(current.id) < 0 ? candidate : current;
    });
    transaction.set(keep.ref, { favorite: snapshots.some(snapshot => Boolean(snapshot.data()?.favorite)), updatedAt: serverTimestamp() }, { merge: true });
    snapshots.filter(snapshot => snapshot.id !== keep.id).forEach(snapshot => transaction.delete(snapshot.ref));
    return { keptFoodId: keep.id, removedCount: snapshots.length - 1, name: String(keep.data()?.name ?? "常用食物") };
  });
}
