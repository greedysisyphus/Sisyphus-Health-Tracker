import { collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { calculateDailyTotals, type FoodEntry, type Nutrition } from "../lib/nutrition";
import type { BodyLog, DailyLog } from "../types/models";

const dailyPath = (userId: string, date: string) => `users/${userId}/dailyLogs/${date}`;

export type DailyOverview = { date: string; waterMl: number; entries: FoodEntry[]; total: Nutrition; weightKg?: number; steps?: number };

export async function listDailyEntries(userId: string, date: string): Promise<FoodEntry[]> {
  if (!db) return [];
  const snapshot = await getDocs(collection(db, dailyPath(userId, date), "entries"));
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() } as FoodEntry)).sort((a, b) => a.time.localeCompare(b.time));
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

export async function listDailyOverviews(userId: string, count = 30): Promise<DailyOverview[]> {
  if (!db) return [];
  const daily = await getDocs(query(collection(db, `users/${userId}/dailyLogs`), orderBy("date", "desc"), limit(count)));
  return Promise.all(daily.docs.map(async item => {
    const data = item.data() as DailyLog;
    const [entries, body] = await Promise.all([listDailyEntries(userId, data.date), getBodyLog(userId, data.date)]);
    return { date: data.date, waterMl: data.waterMl ?? 0, entries, total: calculateDailyTotals(entries), weightKg: body?.weightKg, steps: body?.steps };
  }));
}

export type SavedFoodSummary = { id: string; name: string; brand?: string; category: string; nutrition: { calories: number; protein: number; carbs: number; fat: number }; favorite?: boolean };

export async function listFoods(userId: string): Promise<SavedFoodSummary[]> {
  if (!db) return [];
  const snapshot = await getDocs(query(collection(db, `users/${userId}/foods`), orderBy("name"), limit(100)));
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() } as SavedFoodSummary));
}
