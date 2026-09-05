import { createHash, timingSafeEqual } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { getAdminDb } from "../../../../lib/firebase-admin";
import { getRequestId, logSafeRequestError } from "../../../../lib/request-observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };

const healthImportRecordSchema = z.object({
  date: z.string().date(),
  steps: z.number().nonnegative(),
  syncedAt: z.string().datetime({ offset: true }),
}).strict();

export const healthImportSchema = z.union([
  healthImportRecordSchema.extend({ source: z.literal("apple_health"), syncId: z.string().min(1).max(200).optional() }).strict(),
  z.object({
    source: z.literal("apple_health"),
    syncId: z.string().min(1).max(200).optional(),
    records: z.array(healthImportRecordSchema).min(1).max(7),
  }).strict().superRefine((value, context) => {
    const dates = new Set(value.records.map(record => record.date));
    if (dates.size !== value.records.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "records must contain unique dates" });
    }
  }),
]);

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: noStoreHeaders });
}

function authorized(request: Request, secret: string): boolean {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;

  const supplied = authorization.slice("Bearer ".length);
  const expectedBuffer = Buffer.from(secret);
  const suppliedBuffer = Buffer.from(supplied);

  if (expectedBuffer.length !== suppliedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  const token = process.env.HEALTH_IMPORT_TOKEN;
  const ownerId = process.env.HEALTH_TRACKER_OWNER_ID;
  if (!token || !ownerId || !process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON) {
    return json({ error: "server_not_configured" }, 500);
  }

  if (!authorized(request, token)) return json({ error: "unauthorized" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const parsed = healthImportSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "invalid_request", details: parsed.error.flatten() }, 400);
  }

  const input = parsed.data;
  const records = "records" in input ? input.records : [input];
  const syncId = "syncId" in input ? input.syncId : undefined;
  try {
    const db = getAdminDb();
    const now = FieldValue.serverTimestamp();
    const payloadHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const response = await db.runTransaction(async transaction => {
      const dailyRefs = records.map(record => db.doc(`users/${ownerId}/dailyLogs/${record.date}`));
      const importRef = syncId ? db.doc(`users/${ownerId}/healthImports/${syncId}`) : null;
      const snapshots = await Promise.all(dailyRefs.map(ref => transaction.get(ref)));
      const importSnapshot = importRef ? await transaction.get(importRef) : null;
      const existingImport = importSnapshot?.data();
      if (existingImport) {
        if (existingImport.payloadHash !== payloadHash) throw new Error("sync_id_conflict");
        return { ...(existingImport.response as Record<string, unknown>), replayed: true };
      }

      const accepted = records.filter((record, index) => {
        const currentSyncedAt = snapshots[index].data()?.syncedAt;
        const incomingSyncedAt = new Date(record.syncedAt);
        const currentDate = currentSyncedAt instanceof Date ? currentSyncedAt : currentSyncedAt?.toDate?.();
        return !(currentDate instanceof Date && currentDate.getTime() > incomingSyncedAt.getTime());
      });
      const acceptedDates = new Set(accepted.map(record => record.date));
      for (const record of accepted) {
        const syncedAt = new Date(record.syncedAt);
        const metadata = { source: input.source, syncedAt, ...(syncId ? { syncId } : {}) };
        transaction.set(db.doc(`users/${ownerId}/dailyLogs/${record.date}`), { date: record.date, steps: record.steps, ...metadata, updatedAt: now }, { merge: true });
        transaction.set(db.doc(`users/${ownerId}/bodyLogs/${record.date}`), { date: record.date, steps: record.steps, ...metadata, updatedAt: now, createdAt: now }, { merge: true });
      }

      const result = records.length === 1 && !("records" in input)
        ? { ok: true, date: records[0].date, steps: records[0].steps, accepted: acceptedDates.has(records[0].date), ...(acceptedDates.has(records[0].date) ? {} : { reason: "stale_sync" }) }
        : { ok: true, records: records.map(record => ({ date: record.date, steps: record.steps, accepted: acceptedDates.has(record.date), ...(acceptedDates.has(record.date) ? {} : { reason: "stale_sync" }) })) };
      if (importRef) transaction.set(importRef, { syncId, payloadHash, response: result, createdAt: now, updatedAt: now }, { merge: true });
      return result;
    });
    return json(response);
  } catch (error) {
    if (error instanceof Error && error.message === "sync_id_conflict") return json({ error: "sync_id_conflict" }, 409);
    logSafeRequestError("health-import", requestId, startedAt, error);
    return json({ error: "operation_failed" }, 500);
  }
}
