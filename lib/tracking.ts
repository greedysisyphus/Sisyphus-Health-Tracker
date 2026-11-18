/** What a person chooses to track. Stored on `users/{uid}` as `tracking` and `healthFocus`. */
export type TrackingPrefs = { water: boolean; weight: boolean; steps: boolean };
export type TrackingKey = keyof TrackingPrefs;

export const defaultTracking: TrackingPrefs = { water: true, weight: true, steps: true };

export const trackingOptions: { key: TrackingKey; label: string; hint: string }[] = [
  { key: "water", label: "喝水", hint: "每日水分、喝水按鈕與水分目標" },
  { key: "weight", label: "體重", hint: "每日體重欄位與體重趨勢圖" },
  { key: "steps", label: "步數", hint: "每日步數欄位" },
];

/** Missing or malformed values fall back to "tracked", so older accounts look exactly as before. */
export function parseTracking(profile: Record<string, unknown> | null | undefined): TrackingPrefs {
  const raw = profile?.tracking;
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    water: source.water !== false,
    weight: source.weight !== false,
    steps: source.steps !== false,
  };
}

export function parseHealthFocus(profile: Record<string, unknown> | null | undefined): string {
  const value = profile?.healthFocus;
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

/** Lines appended to Eris's instructions so she only records what the person tracks. */
export function trackingInstructions(prefs: TrackingPrefs, healthFocus = ""): string[] {
  const lines: string[] = [];
  if (!prefs.water) lines.push("使用者不記錄喝水：不要寫 plainWaterMl，飲品的 hydrationMl 填 0，回覆時也不要提水分或喝水目標。使用者明確說要記水時才記。");
  if (!prefs.weight) lines.push("使用者不記錄體重：不要寫 body.weightKg，也不要提醒量體重。使用者明確說要記時才記。");
  if (!prefs.steps) lines.push("使用者不記錄步數：不要寫 body.steps，也不要提步數。");
  if (healthFocus) lines.push(`使用者自己設定的健康重點是「${healthFocus}」，回覆的建議以這個為主。`);
  return lines;
}
