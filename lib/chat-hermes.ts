import { z } from "zod";

/**
 * Dashboard chat → Hermes bridge.
 *
 * The browser never talks to Hermes. A signed-in Firebase user is mapped to exactly one Hermes
 * profile endpoint by server env; a user without a mapping cannot chat. Each chat message becomes
 * one durable Hermes run (Idempotency-Key = message id), so the phone can close as soon as the
 * run is admitted and a retry never logs the same meal twice.
 */

/** `session` keeps each person's Hermes session apart: two profiles must never share a session id. */
export type ChatTarget = { url: string; key: string; session: string };

const MESSAGE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const JPEG_DATA_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/;
export const MAX_PHOTOS = 10;
const MAX_PHOTO_CHARS = 3_000_000; // ~2.2 MB JPEG after base64; the phone keeps the whole request under ~4 MB
const MAX_THUMB_CHARS = 120_000; // ~90 KB; the phone aims for well under this
const MAX_THUMBS_TOTAL = 800_000; // thumbnails live in one Firestore document (1 MiB limit)

export const chatSendSchema = z.object({
  id: z.string().regex(MESSAGE_ID),
  text: z.string().max(2000).default(""),
  photos: z.array(z.string().max(MAX_PHOTO_CHARS).regex(JPEG_DATA_URL)).max(MAX_PHOTOS).default([]),
  thumbs: z.array(z.string().max(MAX_THUMB_CHARS).regex(JPEG_DATA_URL)).max(MAX_PHOTOS).default([]),
}).strict().refine(value => value.text.trim().length > 0 || value.photos.length > 0, { message: "empty_message" })
  .refine(value => value.thumbs.length === value.photos.length, { message: "thumb_count_mismatch" })
  .refine(value => value.thumbs.reduce((sum, thumb) => sum + thumb.length, 0) <= MAX_THUMBS_TOTAL, { message: "thumbs_too_large" });

export type ChatSend = z.infer<typeof chatSendSchema>;

/** Which Hermes profile serves this Firebase user, or null when chat is not set up for them. */
export function resolveChatTarget(uid: string, env: NodeJS.ProcessEnv = process.env): ChatTarget | null {
  const candidates: Array<[string, string | undefined, string | undefined, string | undefined]> = [
    ["secondary", env.HEALTH_TRACKER_SECONDARY_OWNER_ID, env.HERMES_SECONDARY_CHAT_URL, env.HERMES_SECONDARY_CHAT_KEY],
    ["owner", env.HEALTH_TRACKER_OWNER_ID, env.HERMES_CHAT_URL, env.HERMES_CHAT_KEY],
  ];
  for (const [session, owner, url, key] of candidates) {
    if (!owner || owner !== uid || !url || !key || key.length < 32) continue;
    if (!/^https:\/\/[^\s]+$/.test(url) && !/^http:\/\/127\.0\.0\.1(:\d+)?\//.test(url)) continue;
    return { url: url.replace(/\/+$/, ""), key, session };
  }
  return null;
}

/** Asia/Taipei calendar date and clock for the instructions. */
export function taipeiNow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}` };
}

export function runInstructions(messageId: string, now = new Date(), extra: string[] = []) {
  const { date, time } = taipeiNow(now);
  return [
    "你在「Eris Health」網站的聊天頁和使用者對話（不是 Discord）。使用者傳完訊息通常會立刻關掉 App，晚點才回來看你的回覆。",
    `現在是台北時間 ${date} ${time}。使用者沒有說日期時，一律記在 today。`,
    "要記錄飲食、飲水或身體資料時，先載入 health-log skill，照它的流程寫入。腳本固定在 ~/.hermes/skills/health-log/scripts/health_log.py，直接用 python3 執行，不要先找路徑或列目錄。",
    "為了快：寫入前不需要先查今日摘要或常用食物，直接做一次 log_health_event；API 回傳的 dailySummary 就是今天的累計。只有使用者要更正或刪除時才先查。",
    `這則訊息的所有照片與文字合併成一次 log_health_event：eventId 用 "${messageId}"，source 用 "dashboard"。不要改用其他 eventId。`,
    "沒辦法等使用者回答問題：資訊不足時先用合理的份量預估並標好 confidence，在回覆裡講清楚你假設了什麼，她之後可以更正。只有猜錯會差很多（例如完全看不出吃了多少）時，才先不寫入，回一個簡短問題。",
    "如果這則訊息只是聊天或發問，就照常回答，不要寫入任何紀錄。",
    "回覆用繁體中文，口吻溫暖、簡短，最多四行：記了哪些東西、各自大約熱量，以及 API 回傳 dailySummary 的今日累計熱量與蛋白質。只有 API 回傳 ok: true 才能說已記錄。",
    ...extra,
  ].join("\n");
}

export function runRequestBody(message: ChatSend, session: string, now = new Date(), extra: string[] = []) {
  const text = message.text.trim() || (message.photos.length > 1 ? `（${message.photos.length} 張照片）` : "（照片）");
  return {
    input: [{
      role: "user",
      content: [
        { type: "input_text", text },
        // "high": the AI looks at the full-resolution photo, so label print is legible.
        ...message.photos.map(url => ({ type: "input_image", image_url: url, detail: "high" })),
      ],
    }],
    instructions: runInstructions(message.id, now, extra),
    session_id: `dashboard-${session}-${taipeiNow(now).date}`,
  };
}

type FetchLike = typeof fetch;

/** Network-level failure ("fetch failed", timeouts) with the underlying reason, e.g. "fetch failed (ECONNRESET)". */
export function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) return "hermes_unreachable";
  const cause = (error as Error & { cause?: { code?: unknown; message?: unknown } }).cause;
  const detail = cause?.code ?? cause?.message ?? (error.name === "TimeoutError" ? "timeout" : "");
  return detail ? `${error.message} (${String(detail)})` : error.message;
}

class RunRejected extends Error {}

const RETRY_DELAYS_MS = [1_000, 3_000];
/** Tests set CHAT_RETRY_DELAYS_MS="0,0" to skip the waits. */
const retryDelays = () => process.env.CHAT_RETRY_DELAYS_MS?.split(",").map(Number) ?? RETRY_DELAYS_MS;

/**
 * Starts the Hermes run. A dropped connection is retried twice (1s, 3s) with the same Idempotency-Key and the same
 * body, so a retry can only ever reach the same run; an answer from Hermes (e.g. 401, 409) is final.
 */
export async function startRun(target: ChatTarget, message: ChatSend, fetcher: FetchLike = fetch, now = new Date(), extra: string[] = [], delays: number[] = retryDelays()) {
  const body = JSON.stringify(runRequestBody(message, target.session, now, extra));
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, delays[attempt - 1]));
    try {
      const response = await fetcher(`${target.url}/v1/runs`, {
        method: "POST",
        headers: { Authorization: `Bearer ${target.key}`, "Content-Type": "application/json", "Idempotency-Key": `dashboard-chat-${message.id}` },
        body,
        signal: AbortSignal.timeout(12_000),
      });
      const result = await response.json().catch(() => ({})) as { run_id?: unknown; error?: { code?: unknown } };
      if (!response.ok || typeof result.run_id !== "string") {
        throw new RunRejected(`hermes_run_rejected:${response.status}:${String(result.error?.code ?? "")}`);
      }
      return result.run_id;
    } catch (error) {
      if (error instanceof RunRejected) throw error;
      lastError = error;
    }
  }
  throw new Error(describeFetchError(lastError));
}

export type RunOutcome =
  | { state: "running" }
  | { state: "done"; reply: string }
  | { state: "failed"; error: string }
  | { state: "expired" };

export async function readRun(target: ChatTarget, runId: string, fetcher: FetchLike = fetch): Promise<RunOutcome> {
  const response = await fetcher(`${target.url}/v1/runs/${encodeURIComponent(runId)}`, {
    headers: { Authorization: `Bearer ${target.key}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return { state: "expired" };
  if (!response.ok) return { state: "running" };
  const body = await response.json().catch(() => ({})) as { status?: string; output?: unknown; error?: unknown };
  if (body.status === "completed") return { state: "done", reply: typeof body.output === "string" ? body.output.slice(0, 4000) : "" };
  if (body.status === "failed" || body.status === "cancelled" || body.status === "interrupted") {
    return { state: "failed", error: String(body.status) };
  }
  return { state: "running" };
}
