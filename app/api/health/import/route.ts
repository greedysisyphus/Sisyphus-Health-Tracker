import { timingSafeEqual } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { getAdminDb } from "../../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };

const healthImportRecordSchema = z.object({
  date: z.string().date(),
  steps: z.number().nonnegative(),
  syncedAt: z.string().datetime({ offset: true }),
}).strict();

export const healthImportSchema = z.union([
  healthImportRecordSchema.extend({ source: z.literal("apple_health") }).strict(),
  z.object({
    source: z.literal("apple_health"),
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
  try {
    const db = getAdminDb();
    const now = FieldValue.serverTimestamp();
    await Promise.all(records.flatMap(record => {
      const syncedAt = new Date(record.syncedAt);
      const dailyPayload = {
        date: record.date,
        steps: record.steps,
        source: input.source,
        syncedAt,
        updatedAt: now,
      };
      const bodyPayload = {
        date: record.date,
        steps: record.steps,
        updatedAt: now,
        createdAt: now,
      };
      return [
        db.doc(`users/${ownerId}/dailyLogs/${record.date}`).set(dailyPayload, { merge: true }),
        db.doc(`users/${ownerId}/bodyLogs/${record.date}`).set(bodyPayload, { merge: true }),
      ];
    }));

    if (records.length === 1 && !("records" in input)) {
      return json({ ok: true, date: records[0].date, steps: records[0].steps });
    }
    return json({
      ok: true,
      records: records.map(record => ({ date: record.date, steps: record.steps })),
    });
  } catch (error) {
    console.error("Apple Health import failed", error);
    return json({ error: "operation_failed" }, 500);
  }
}
