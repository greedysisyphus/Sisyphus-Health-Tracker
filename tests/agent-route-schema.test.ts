import { describe, expect, it } from "vitest";
import { actionSchema } from "../app/api/agent/route";

const nutrition = { calories: 1, protein: 1, carbs: 1, fat: 1 };

describe("agent route composite schema", () => {
  const base = {
    action: "log_health_event",
    date: "2026-07-15",
    plainWaterMl: 0,
    idempotency: { source: "discord", eventId: "message", operationKey: "health-event" },
  };

  it("rejects caller-supplied entry ids", () => {
    const parsed = actionSchema.safeParse({ ...base, entries: [{ id: "existing", name: "食物", meal: "點心", nutrition }] });
    expect(parsed.success).toBe(false);
  });

  it("caps the number of foods in one transaction", () => {
    const entries = Array.from({ length: 51 }, (_, index) => ({ name: `食物 ${index}`, meal: "點心", nutrition }));
    expect(actionSchema.safeParse({ ...base, entries }).success).toBe(false);
  });

  it("accepts bounded daily summary backfills", () => {
    expect(actionSchema.safeParse({ action: "backfill_daily_summaries", dates: ["2026-07-15"] }).success).toBe(true);
    expect(actionSchema.safeParse({ action: "backfill_daily_summaries", dates: Array.from({ length: 1001 }, () => "2026-07-15") }).success).toBe(false);
  });

  it("accepts the saved-food search token migration action", () => {
    expect(actionSchema.safeParse({ action: "backfill_food_search_tokens" }).success).toBe(true);
  });
});
