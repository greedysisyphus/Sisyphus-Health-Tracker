import { describe, expect, it } from "vitest";
import {
  assertAllowedAmendChanges,
  buildHealthEventPlan,
  canonicalPayloadHash,
  idempotencyDocumentId,
  nextWaterMl,
  resolveIdempotency,
} from "../lib/agent-health";

const nutrition = {
  calories: 100,
  protein: 10,
  carbs: 12,
  fat: 2,
  fiber: 1,
  sugar: 2,
  saturatedFat: 0.5,
  transFat: null,
  sodium: 50,
  potassium: null,
  cholesterol: null,
  caffeine: 0,
};

describe("Hermes health write contract", () => {
  it("hashes semantically identical payloads identically", () => {
    expect(canonicalPayloadHash({ b: 2, a: { y: 1, x: 0 } })).toBe(
      canonicalPayloadHash({ a: { x: 0, y: 1 }, b: 2 }),
    );
  });

  it("creates a stable safe Firestore id for one source event operation", () => {
    const first = idempotencyDocumentId({ source: "discord", eventId: "1526915932478509106", operationKey: "health-event" });
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(idempotencyDocumentId({ source: "discord", eventId: "1526915932478509106", operationKey: "health-event" }));
    expect(first).not.toBe(idempotencyDocumentId({ source: "discord", eventId: "1526915932478509106", operationKey: "water" }));
    expect(idempotencyDocumentId({ source: "a", eventId: "b:c", operationKey: "d" })).not.toBe(
      idempotencyDocumentId({ source: "a:b", eventId: "c", operationKey: "d" }),
    );
  });

  it("preserves manual water when legacy hydration was never included in the aggregate", () => {
    expect(nextWaterMl(0, 200, 0, 200)).toBe(0);
    expect(nextWaterMl(100, 200, 0, 200)).toBe(100);
    expect(nextWaterMl(500, 200, 0, 200)).toBe(300);
    expect(nextWaterMl(100, 200, 300, 200)).toBe(200);
  });

  it("replays the same idempotent request and rejects conflicting content", () => {
    expect(resolveIdempotency({ payloadHash: "same", response: { ok: true } }, "same")).toEqual({
      kind: "replay",
      response: { ok: true, replayed: true },
    });
    expect(() => resolveIdempotency({ payloadHash: "old", response: { ok: true } }, "new")).toThrow(
      "idempotency_conflict",
    );
    expect(resolveIdempotency(null, "new")).toEqual({ kind: "new" });
  });

  it("allows only nutrition backfill fields in history mode", () => {
    expect(() => assertAllowedAmendChanges({ nutrition }, "history_backfill")).not.toThrow();
    expect(() => assertAllowedAmendChanges({ hydrationMl: 200 }, "history_backfill")).toThrow(
      "disallowed_amend_field:hydrationMl",
    );
    expect(() => assertAllowedAmendChanges({ name: "renamed" }, "standard")).toThrow(
      "disallowed_amend_field:name",
    );
  });

  it("plans food and plain water as one event and returns the authoritative resulting summary", () => {
    const plan = buildHealthEventPlan({
      date: "2026-07-15",
      entries: [
        {
          id: "coffee",
          name: "冰美式",
          meal: "飲料",
          servings: 1,
          servingWeightG: 350,
          hydrationMl: 350,
          nutrition,
          source: "ai_estimated",
          confidence: "medium",
          time: "現在",
        },
      ],
      plainWaterMl: 1000,
      currentWaterMl: 400,
      currentEntries: [
        {
          caloriesKcal: 200,
          proteinG: 20,
          carbsG: 30,
          fatG: 5,
          fiberG: 2,
          sugarG: 4,
          saturatedFatG: 1,
          transFatG: null,
          sodiumMg: 300,
          potassiumMg: null,
          cholesterolMg: null,
          caffeineMg: 0,
          servings: 1,
        },
      ],
    });

    expect(plan.waterMl).toBe(1750);
    expect(plan.dailySummary).toMatchObject({
      caloriesKcal: 300,
      proteinG: 30,
      sodiumMg: 350,
      waterMl: 1750,
    });
    expect(plan.entries[0]).toMatchObject({ id: "coffee", caloriesKcal: 100, hydrationMl: 350 });
  });

  it("applies servings once when calculating a composite event", () => {
    const plan = buildHealthEventPlan({
      date: "2026-07-15",
      entries: [
        {
          id: "eggs",
          name: "茶葉蛋",
          meal: "早餐",
          servings: 2,
          nutrition: { ...nutrition, calories: 70, protein: 6 },
        },
      ],
      plainWaterMl: 0,
      currentWaterMl: 0,
      currentEntries: [],
    });
    expect(plan.dailySummary.caloriesKcal).toBe(140);
    expect(plan.dailySummary.proteinG).toBe(12);
  });
});
