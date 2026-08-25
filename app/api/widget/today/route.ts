import { timingSafeEqual } from "crypto";
import { totalForEntryData } from "../../../../lib/agent-health";
import { getAdminDb } from "../../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.WIDGET_READ_TOKEN;
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) return false;

  const supplied = authorization.slice("Bearer ".length);
  const expectedBuffer = Buffer.from(secret);
  const suppliedBuffer = Buffer.from(supplied);

  if (expectedBuffer.length !== suppliedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function taipeiDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const ownerId = process.env.HEALTH_TRACKER_OWNER_ID;
  if (!ownerId) {
    return Response.json({ error: "server_not_configured" }, { status: 500 });
  }

  try {
    const date = taipeiDate();
    const db = getAdminDb();
    const dayRef = db.doc(`users/${ownerId}/dailyLogs/${date}`);

    const [entriesSnapshot, dailySnapshot] = await Promise.all([
      dayRef.collection("entries").get(),
      dayRef.get(),
    ]);

    const total = totalForEntryData(entriesSnapshot.docs.map(document => document.data()));
    const daily = dailySnapshot.data();

    return Response.json({
      date,
      caloriesKcal: total.caloriesKcal,
      proteinG: total.proteinG,
      fiberG: total.fiberG,
      sodiumMg: total.sodiumMg,
      caffeineMg: total.caffeineMg,
      waterMl: Number(daily?.waterMl ?? 0),
      steps: typeof daily?.steps === "number" ? daily.steps : null,
      weightKg: typeof daily?.weightKg === "number" ? daily.weightKg : null,
    }, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Widget health API failed", error);
    return Response.json({ error: "operation_failed" }, { status: 500 });
  }
}
