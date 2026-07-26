import { describe, expect, it } from "vitest";
import { buildWeightTrendChart, collectWeightSamples, weightDomain } from "../lib/weight-trend";

describe("weight trend", () => {
  it("drops missing weights and sorts by date", () => {
    expect(collectWeightSamples([
      { date: "2026-07-20", weightKg: 74.2 },
      { date: "2026-07-10", weightKg: null },
      { date: "2026-07-05", weightKg: 75 },
      { date: "2026-07-01", weightKg: 0 },
    ])).toEqual([
      { date: "2026-07-05", weightKg: 75 },
      { date: "2026-07-20", weightKg: 74.2 },
    ]);
  });

  it("connects non-contiguous samples on a true date axis", () => {
    const chart = buildWeightTrendChart([
      { date: "2026-07-01", weightKg: 76 },
      { date: "2026-07-10", weightKg: 75 },
      { date: "2026-07-20", weightKg: 74 },
    ], { width: 720, height: 320 });

    expect(chart).not.toBeNull();
    expect(chart!.points).toHaveLength(3);
    expect(chart!.path.startsWith("M")).toBe(true);
    expect(chart!.path.includes(" L")).toBe(true);
    // Middle point sits between first and last on x because of calendar gaps.
    expect(chart!.points[1].x).toBeGreaterThan(chart!.points[0].x);
    expect(chart!.points[1].x).toBeLessThan(chart!.points[2].x);
    // July 10 is closer to July 1 than July 20 on a 19-day span (9 vs 10).
    const span = chart!.points[2].x - chart!.points[0].x;
    expect(chart!.points[1].x - chart!.points[0].x).toBeCloseTo(span * (9 / 19), 5);
    expect(chart!.deltaKg).toBe(-2);
    expect(chart!.averageKg).toBe(75);
    // A 2 kg drop should occupy a meaningful share of plot height, not a flat ribbon.
    const plotTop = Math.min(...chart!.points.map(point => point.y));
    const plotBottom = Math.max(...chart!.points.map(point => point.y));
    expect(plotBottom - plotTop).toBeGreaterThan(120);
  });

  it("keeps a readable vertical domain for multi-kg changes", () => {
    const wide = weightDomain(72.3, 76.7);
    expect(wide.lo).toBeLessThanOrEqual(72.3);
    expect(wide.hi).toBeGreaterThanOrEqual(76.7);
    expect(wide.hi - wide.lo).toBeGreaterThan(4);
    const tight = weightDomain(72.2, 72.5);
    expect(tight.hi - tight.lo).toBeGreaterThanOrEqual(2);
  });

  it("still renders a single measurement without a line segment requirement failure", () => {
    const chart = buildWeightTrendChart([{ date: "2026-07-15", weightKg: 74.5 }]);
    expect(chart?.points).toHaveLength(1);
    expect(chart?.path.startsWith("M")).toBe(true);
    expect(chart?.deltaKg).toBe(0);
  });
});
