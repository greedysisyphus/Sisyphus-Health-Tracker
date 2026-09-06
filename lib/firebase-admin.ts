import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccountJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON;

/**
 * Firestore-only admin entrypoint.
 * Do not import firebase-admin/auth here — on Vercel with serverExternalPackages,
 * auth pulls jwks-rsa → jose ESM and crashes the whole /api/agent module load
 * with an empty HTTP 500.
 */
export function ensureAdminApp(): App {
  if (!serviceAccountJson) throw new Error("Firebase server credentials are not configured.");
  if (!getApps().length) {
    initializeApp({ credential: cert(JSON.parse(serviceAccountJson)) });
  }
  return getApps()[0]!;
}

export function getAdminDb() {
  ensureAdminApp();
  return getFirestore();
}
