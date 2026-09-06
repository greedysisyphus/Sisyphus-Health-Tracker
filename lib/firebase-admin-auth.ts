import { getAuth } from "firebase-admin/auth";
import { ensureAdminApp } from "./firebase-admin";

/** Auth-only admin entrypoint. Keep separate so firestore routes never load jose. */
export function getAdminAuth() {
  ensureAdminApp();
  return getAuth();
}
