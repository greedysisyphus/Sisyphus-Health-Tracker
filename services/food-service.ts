import { collection, deleteDoc, doc, getDocs, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import type { StoredFood } from "../types/models";

const foodsPath = (userId: string) => `users/${userId}/foods`;
export async function listFoods(userId: string): Promise<StoredFood[]> {
  if (!db) return [];
  const snapshot = await getDocs(collection(db, foodsPath(userId)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as StoredFood));
}
export async function saveFood(userId: string, food: StoredFood): Promise<void> {
  if (!db) throw new Error("Firebase 尚未設定");
  await setDoc(doc(db, foodsPath(userId), food.id), food);
}
export async function removeFood(userId: string, foodId: string): Promise<void> {
  if (!db) throw new Error("Firebase 尚未設定");
  await deleteDoc(doc(db, foodsPath(userId), foodId));
}
