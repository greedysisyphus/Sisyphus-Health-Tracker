import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyIdToken, agentPost } = vi.hoisted(() => ({ verifyIdToken: vi.fn(), agentPost: vi.fn() }));

vi.mock("../lib/firebase-admin-auth", () => ({ getAdminAuth: () => ({ verifyIdToken }) }));
vi.mock("../app/api/agent/route", () => ({ POST: agentPost }));

import { POST } from "../app/api/history/replace/route";

const validData = {
  schema_version: "3.0",
  exported_at: "2026-09-05T15:00:00.000Z",
  timezone: "Asia/Taipei",
  date_range: { start: "2026-09-01", end: "2026-09-05" },
  daily_records: [{ date: "2026-09-04", meals: [], beverages: [] }],
};

function request(body: unknown, token = "firebase-id-token") {
  return new Request("https://example.com/api/history/replace", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("browser history replace route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.HERMES_API_SECRET = "test-hmac-secret";
    process.env.HEALTH_TRACKER_OWNER_ID = "owner-id";
    process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON = "{}";
    verifyIdToken.mockResolvedValue({ uid: "owner-id" });
    agentPost.mockResolvedValue(new Response(JSON.stringify({ ok: true, action: "replace_history_export" }), { status: 200 }));
  });

  it("rejects missing or invalid Firebase credentials", async () => {
    expect((await POST(request(validData, ""))).status).toBe(401);
    verifyIdToken.mockRejectedValueOnce(new Error("invalid token"));
    expect((await POST(request(validData))).status).toBe(401);
    expect(agentPost).not.toHaveBeenCalled();
  });

  it("rejects an authenticated user who is not the configured owner", async () => {
    verifyIdToken.mockResolvedValueOnce({ uid: "another-user" });
    const response = await POST(request(validData));
    expect(response.status).toBe(403);
    expect(agentPost).not.toHaveBeenCalled();
  });

  it("validates the export and forwards it through the server-side Agent path", async () => {
    const response = await POST(request({ data: validData, preserveExistingWaterDates: ["2026-09-02"] }));
    expect(response.status).toBe(200);
    expect(agentPost).toHaveBeenCalledOnce();
    const forwarded = agentPost.mock.calls[0][0] as Request;
    const body = await forwarded.json();
    expect(body).toEqual({ action: "replace_history_export", data: validData, preserveExistingWaterDates: ["2026-09-02"] });
    expect(forwarded.headers.get("x-health-signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(forwarded.headers.get("x-health-timestamp")).toMatch(/^\d+$/);
  });
});
