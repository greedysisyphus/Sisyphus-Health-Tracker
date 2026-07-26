export type WeightSample = { date: string; weightKg: number };

export type WeightChartPoint = WeightSample & { x: number; y: number };

export type WeightTrendChart = {
  width: number;
  height: number;
  path: string;
  points: WeightChartPoint[];
  yTicks: { value: number; y: number; label: string }[];
  xLabels: { date: string; x: number; label: string; anchor: "start" | "middle" | "end" }[];
  minWeight: number;
  maxWeight: number;
  latest: WeightSample;
  first: WeightSample;
  deltaKg: number;
  averageKg: number;
  domain: { lo: number; hi: number };
};

const dayIndex = (date: string) => Math.round(new Date(`${date}T12:00:00Z`).getTime() / 86_400_000);

/** Keep only positive finite weights and sort by date ascending. */
export function collectWeightSamples(rows: { date: string; weightKg?: number | null }[]): WeightSample[] {
  return rows
    .filter((row): row is { date: string; weightKg: number } =>
      typeof row.date === "string"
      && typeof row.weightKg === "number"
      && Number.isFinite(row.weightKg)
      && row.weightKg > 0)
    .map(row => ({ date: row.date, weightKg: row.weightKg }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Choose a readable Y domain that keeps real change visible without huge empty bands. */
export function weightDomain(minWeight: number, maxWeight: number): { lo: number; hi: number } {
  const span = Math.max(maxWeight - minWeight, 0);
  // Tight padding so small kg changes still look like a slope, not a flat ribbon.
  const pad = Math.max(span * 0.08, 0.25);
  let lo = minWeight - pad;
  let hi = maxWeight + pad;
  // Snap to 0.5 kg ticks for cleaner axis labels.
  lo = Math.floor(lo * 2) / 2;
  hi = Math.ceil(hi * 2) / 2;
  // Keep at least ~2 kg of vertical room so multi-kg drops read clearly.
  if (hi - lo < 2) {
    const mid = (minWeight + maxWeight) / 2;
    lo = Math.floor((mid - 1) * 2) / 2;
    hi = Math.ceil((mid + 1) * 2) / 2;
  }
  if (hi <= lo) hi = lo + 2;
  return { lo, hi };
}

/**
 * Build an SVG polyline that connects sparse weight samples by calendar day.
 * Missing days do not break the line — points are placed on a true date axis.
 */
export function buildWeightTrendChart(
  samples: WeightSample[],
  options?: {
    width?: number;
    height?: number;
    padding?: { top: number; right: number; bottom: number; left: number };
  },
): WeightTrendChart | null {
  if (!samples.length) return null;

  // Taller default canvas so wide mobile/desktop cards don't squash slopes.
  const width = options?.width ?? 720;
  const height = options?.height ?? 320;
  const padding = options?.padding ?? { top: 16, right: 20, bottom: 36, left: 48 };
  const plotW = Math.max(width - padding.left - padding.right, 1);
  const plotH = Math.max(height - padding.top - padding.bottom, 1);

  const xs = samples.map(sample => dayIndex(sample.date));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const spanX = Math.max(maxX - minX, 1);

  const weights = samples.map(sample => sample.weightKg);
  const minWeight = Math.min(...weights);
  const maxWeight = Math.max(...weights);
  const { lo, hi } = weightDomain(minWeight, maxWeight);
  const spanW = Math.max(hi - lo, 0.1);

  const project = (sample: WeightSample): WeightChartPoint => {
    const x = padding.left + ((dayIndex(sample.date) - minX) / spanX) * plotW;
    const y = padding.top + (1 - (sample.weightKg - lo) / spanW) * plotH;
    return { ...sample, x, y };
  };

  const points = samples.map(project);
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");

  const tickCount = 5;
  const yTicks = Array.from({ length: tickCount }, (_, index) => {
    const ratio = index / (tickCount - 1);
    const value = hi - ratio * spanW;
    const y = padding.top + ratio * plotH;
    return { value, y, label: value.toFixed(1) };
  });

  const labelIndexes = samples.length === 1
    ? [0]
    : samples.length === 2
      ? [0, 1]
      : [0, Math.floor((samples.length - 1) / 2), samples.length - 1];
  const xLabels = [...new Set(labelIndexes)].map((index, order, all) => {
    const point = points[index];
    const anchor: "start" | "middle" | "end" = all.length === 1 ? "middle" : order === 0 ? "start" : order === all.length - 1 ? "end" : "middle";
    return { date: point.date, x: point.x, label: point.date.slice(5), anchor };
  });

  const first = samples[0];
  const latest = samples[samples.length - 1];
  const averageKg = Math.round((weights.reduce((sum, weight) => sum + weight, 0) / weights.length) * 10) / 10;
  const deltaKg = Math.round((latest.weightKg - first.weightKg) * 10) / 10;

  return {
    width,
    height,
    path,
    points,
    yTicks,
    xLabels,
    minWeight,
    maxWeight,
    latest,
    first,
    deltaKg,
    averageKg,
    domain: { lo, hi },
  };
}
