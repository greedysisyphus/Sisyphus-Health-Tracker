import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = path.resolve("hermes/health-log/scripts/health_log.py");

describe("health_log.py workflow wrapper", () => {
  it("normalizes one Discord event into the composite API contract", () => {
    const input = {
      intent: "log_health_event",
      date: "2026-07-15",
      eventId: "1526915932478509106",
      entries: [],
      plainWaterMl: 500,
    };
    const output = execFileSync("python3", [script, "--dry-run"], {
      input: JSON.stringify(input),
      encoding: "utf8",
    });
    expect(JSON.parse(output)).toEqual({
      action: "log_health_event",
      date: "2026-07-15",
      entries: [],
      plainWaterMl: 500,
      idempotency: {
        source: "discord",
        eventId: "1526915932478509106",
        operationKey: "health-event",
      },
    });
  });

  it("rejects a write without an event id", () => {
    const result = spawnSync("python3", [script, "--dry-run"], {
      input: JSON.stringify({ intent: "log_health_event", date: "2026-07-15", plainWaterMl: 500 }),
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("eventId is required");
  });

  it("rejects legacy additive writes that bypass event idempotency", () => {
    const result = spawnSync("python3", [script, "--dry-run"], {
      input: JSON.stringify({ action: "log_water", date: "2026-07-15", addMl: 500 }),
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("legacy write action is not allowed");
  });

  it("still permits read and correction actions", () => {
    const output = execFileSync("python3", [script, "--dry-run"], {
      input: JSON.stringify({ action: "get_daily_summary", date: "2026-07-15" }),
      encoding: "utf8",
    });
    expect(JSON.parse(output)).toEqual({ action: "get_daily_summary", date: "2026-07-15" });
  });
});
