import { createHmac } from "crypto";
import { z } from "zod";
import { getAdminAuth } from "../../../../lib/firebase-admin";
import { historyExportSchema } from "../../../../lib/history-export";
import { POST as agentPost } from "../../agent/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };
const requestSchema = z.object({
  data: historyExportSchema,
  preserveExistingWaterDates: z.array(z.string().date()).default([]),
}).strict();

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: noStoreHeaders });
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const secret = process.env.HERMES_API_SECRET;
  const ownerId = process.env.HEALTH_TRACKER_OWNER_ID;
  if (!secret || !ownerId || !process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON) return json({ error: "server_not_configured" }, 500);

  let userId: string;
  try {
    const token = authorization.slice("Bearer ".length);
    userId = (await getAdminAuth().verifyIdToken(token)).uid;
  } catch {
    return json({ error: "unauthorized" }, 401);
  }
  if (userId !== ownerId) return json({ error: "forbidden" }, 403);

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return json({ error: "invalid_request", details: parsed.error.flatten() }, 400);

  const agentBody = JSON.stringify({
    action: "replace_history_export",
    data: parsed.data.data,
    preserveExistingWaterDates: parsed.data.preserveExistingWaterDates,
  });
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", secret).update(`${timestamp}.${agentBody}`).digest("hex");
  const response = await agentPost(new Request("https://internal/api/agent", {
    method: "POST",
    headers: { "content-type": "application/json", "x-health-timestamp": timestamp, "x-health-signature": signature },
    body: agentBody,
  }));
  return new Response(response.body, { status: response.status, headers: noStoreHeaders });
}
