import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = { path: string; next: (snapshot: unknown) => void; stop: ReturnType<typeof vi.fn> };
const listeners: Listener[] = [];

vi.mock("../lib/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join("/") }),
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join("/") }),
  onSnapshot: (ref: { path: string }, next: (snapshot: unknown) => void) => {
    const stop = vi.fn();
    listeners.push({ path: ref.path, next, stop });
    return stop;
  },
}));

const { watchDay } = await import("../services/health-service");

const listener = (suffix: string) => {
  const found = listeners.find(item => item.path.endsWith(suffix));
  if (!found) throw new Error(`no listener for ${suffix}`);
  return found;
};
const docSnap = (data: Record<string, unknown> | null) => ({ exists: () => data !== null, data: () => data });
const entriesSnap = (names: string[]) => ({ docs: names.map((name, index) => ({ id: `e${index}`, data: () => ({ name, time: `0${index}:00`, servings: 1, nutrition: { caloriesKcal: 100 } }) })) });

describe("live view of one day", () => {
  beforeEach(() => { listeners.length = 0; });

  it("waits for entries, the day and the body log, then follows every later change", () => {
    const onChange = vi.fn();
    const stop = watchDay("u1", "2026-11-19", onChange, vi.fn());
    expect(listeners.map(item => item.path)).toEqual([
      "users/u1/dailyLogs/2026-11-19/entries",
      "users/u1/dailyLogs/2026-11-19",
      "users/u1/bodyLogs/2026-11-19",
    ]);

    listener("/entries").next(entriesSnap(["香蕉"]));
    listener("dailyLogs/2026-11-19").next(docSnap({ waterMl: 300 }));
    expect(onChange).not.toHaveBeenCalled();
    listener("bodyLogs/2026-11-19").next(docSnap(null));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].entries.map((entry: { name: string }) => entry.name)).toEqual(["香蕉"]);
    expect(onChange.mock.calls[0][0].daily).toEqual({ waterMl: 300 });
    expect(onChange.mock.calls[0][0].body).toBeNull();

    // Eris records a rice ball from the chat: it shows up without any refresh.
    listener("/entries").next(entriesSnap(["香蕉", "雞肉飯飯糰"]));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][0].entries).toHaveLength(2);

    stop();
    for (const item of listeners) expect(item.stop).toHaveBeenCalledTimes(1);
  });
});
