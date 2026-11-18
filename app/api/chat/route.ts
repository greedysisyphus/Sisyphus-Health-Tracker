import { after } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth } from "../../../lib/firebase-admin-auth";
import { getAdminDb } from "../../../lib/firebase-admin";
import { chatSendSchema, readRun, resolveChatTarget, startRun, taipeiNow, type ChatTarget } from "../../../lib/chat-hermes";
import { parseHealthFocus, parseTracking, trackingInstructions } from "../../../lib/tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const noStore = { "Cache-Control": "private, no-store, max-age=0" };
const json = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: noStore });

/** How long the request keeps watching a run after answering the phone. */
const WATCH_MS = 270_000;
const POLL_MS = 4_000;
/** A processing message older than this is checked again when the page opens. */
const STALE_MS = 15_000;

async function signedInUser(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  try { return (await getAdminAuth().verifyIdToken(authorization.slice("Bearer ".length))).uid; } catch { return null; }
}

const messages = (uid: string) => getAdminDb().collection(`users/${uid}/chatMessages`);

async function settle(uid: string, id: string, target: ChatTarget, runId: string) {
  const outcome = await readRun(target, runId);
  const ref = messages(uid).doc(id);
  if (outcome.state === "done") await ref.update({ status: "done", reply: outcome.reply, updatedAt: FieldValue.serverTimestamp() });
  else if (outcome.state === "failed") await ref.update({ status: "failed", error: outcome.error, updatedAt: FieldValue.serverTimestamp() });
  else if (outcome.state === "expired") await ref.update({ status: "done", reply: null, updatedAt: FieldValue.serverTimestamp() });
  return outcome.state;
}

async function watch(uid: string, id: string, target: ChatTarget, runId: string) {
  const deadline = Date.now() + WATCH_MS;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
    try { if (await settle(uid, id, target, runId) !== "running") return; } catch { /* keep watching */ }
  }
}

/** Send one message (text and/or photos). Answers as soon as Hermes has admitted the run. */
export async function POST(request: Request) {
  const uid = await signedInUser(request);
  if (!uid) return json({ error: "unauthorized" }, 401);
  const target = resolveChatTarget(uid);
  if (!target) return json({ error: "chat_not_enabled" }, 403);

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = chatSendSchema.safeParse(body);
  if (!parsed.success) return json({ error: "invalid_request" }, 400);
  const message = parsed.data;

  const ref = messages(uid).doc(message.id);
  const existing = await ref.get();
  const previous = existing.exists ? existing.data() as { status?: string; attemptAt?: number; extra?: unknown } : null;
  // Already admitted: the phone is retrying a send whose answer it never saw.
  if (previous && previous.status !== "retry" && previous.status !== "sending") {
    return json({ ok: true, id: message.id, status: previous.status ?? "processing" });
  }

  // A retry must send Hermes the exact same request, or its idempotency check refuses it.
  const now = new Date(typeof previous?.attemptAt === "number" ? previous.attemptAt : Date.now());
  let extra: string[];
  if (Array.isArray(previous?.extra)) extra = previous.extra.filter((line): line is string => typeof line === "string");
  else {
    const profile = await getAdminDb().doc(`users/${uid}`).get();
    const data = profile.exists ? profile.data() ?? null : null;
    extra = trackingInstructions(parseTracking(data), parseHealthFocus(data));
  }
  if (!previous) {
    await ref.set({
      text: message.text.trim(), thumbs: message.thumbs, photoCount: message.photos.length, attemptAt: now.getTime(), extra,
      date: taipeiNow(now).date, status: "sending", reply: null, error: null, runId: null,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
  }

  let runId: string;
  try {
    runId = await startRun(target, message, fetch, now, extra);
  } catch (error) {
    await ref.update({ status: "retry", error: error instanceof Error ? error.message.slice(0, 200) : "hermes_unreachable", updatedAt: FieldValue.serverTimestamp() });
    return json({ error: "hermes_unavailable" }, 503);
  }
  await ref.update({ status: "processing", runId, error: null, updatedAt: FieldValue.serverTimestamp() });
  after(() => watch(uid, message.id, target, runId));
  return json({ ok: true, id: message.id, status: "processing" });
}

/** Called when the page opens: pick up replies that finished while the phone was closed. */
export async function GET(request: Request) {
  const uid = await signedInUser(request);
  if (!uid) return json({ error: "unauthorized" }, 401);
  const target = resolveChatTarget(uid);
  if (!target) return json({ enabled: false });

  const pending = await messages(uid).where("status", "==", "processing").limit(10).get();
  const stale = pending.docs.filter(doc => {
    const updated = doc.get("updatedAt")?.toMillis?.() ?? 0;
    return typeof doc.get("runId") === "string" && Date.now() - updated > STALE_MS;
  });
  await Promise.allSettled(stale.map(doc => settle(uid, doc.id, target, doc.get("runId"))));
  return json({ enabled: true, checked: stale.length });
}
