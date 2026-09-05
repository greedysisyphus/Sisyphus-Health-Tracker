import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccountJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON;

function ensureAdminApp() {
  if (!serviceAccountJson) throw new Error("Firebase server credentials are not configured.");
  if (!getApps().length) initializeApp({ credential: cert(JSON.parse(serviceAccountJson)) });
  return getApps()[0];
}

export function getAdminDb() {
  ensureAdminApp();
  return getFirestore();
}

export function getAdminAuth() {
  ensureAdminApp();
  return getAuth();
}
