import { describe, expect, it } from "vitest";
import { getRequestId, safeRequestError } from "../lib/request-observability";

describe("request observability", () => {
  it("preserves a valid incoming request id", () => {
    const request = new Request("https://example.com", { headers: { "x-request-id": "req_abc-123" } });
    expect(getRequestId(request)).toBe("req_abc-123");
  });

  it("replaces malformed or oversized request ids", () => {
    const request = new Request("https://example.com", { headers: { "x-request-id": "bad value" } });
    expect(getRequestId(request)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns a safe error record without the original error object", () => {
    const record = safeRequestError("agent", "req-1", 42);
    expect(record).toEqual({ service: "agent", requestId: "req-1", elapsedMs: 42, error: "operation_failed" });
    expect(JSON.stringify(record)).not.toContain("secret-token");
  });
});
