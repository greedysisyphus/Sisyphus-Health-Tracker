import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccountJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON;

export function getAdminDb() {
  if (!serviceAccountJson) throw new Error("Firebase server credentials are not configured.");
  if (!getApps().length) initializeApp({ credential: cert(JSON.parse(serviceAccountJson)) });
  return getFirestore();
}
