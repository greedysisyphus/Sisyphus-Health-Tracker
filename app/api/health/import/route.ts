import { timingSafeEqual } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { getAdminDb } from "../../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export const healthImportSchema = z.object({
  date: z.string().date(),
  steps: z.number().nonnegative(),
  source: z.literal("apple_health"),
  syncedAt: z.string().datetime({ offset: true }),
}).strict();

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
  try {
    const db = getAdminDb();
    const now = FieldValue.serverTimestamp();
    const syncedAt = new Date(input.syncedAt);
    const dailyPayload = {
      date: input.date,
      steps: input.steps,
      source: input.source,
      syncedAt,
      updatedAt: now,
    };
    const bodyPayload = {
      date: input.date,
      steps: input.steps,
      updatedAt: now,
      createdAt: now,
    };

    await Promise.all([
      db.doc(`users/${ownerId}/dailyLogs/${input.date}`).set(dailyPayload, { merge: true }),
      db.doc(`users/${ownerId}/bodyLogs/${input.date}`).set(bodyPayload, { merge: true }),
    ]);

    return json({ ok: true, date: input.date, steps: input.steps });
  } catch (error) {
    console.error("Apple Health import failed", error);
    return json({ error: "operation_failed" }, 500);
  }
}
