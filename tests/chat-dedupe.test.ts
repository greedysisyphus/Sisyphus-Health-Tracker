import { describe, expect, it } from "vitest";
import { duplicateIds, type OutboxItem } from "../lib/chat-client";
import { runInstructions, withdrawable } from "../lib/chat-hermes";

const photo = (seed: string) => `data:image/jpeg;base64,${seed.repeat(200)}`;
const item = (id: string, createdAt: number, text: string, photos: string[]): OutboxItem => ({ id, text, photos, thumbs: photos, createdAt });

describe("stuck sends", () => {
  it("drops the later copy of the same photos sent twice, keeps the first", () => {
    const pasta = [photo("AAAA"), photo("BBBB")];
    expect(duplicateIds([item("m2", 2, "", pasta), item("m1", 1, "", pasta), item("m3", 3, "", [photo("CCCC")])])).toEqual(["m2"]);
  });

  it("keeps text-only repeats, they can be real", () => {
    expect(duplicateIds([item("m1", 1, "喝水 300ml", []), item("m2", 2, "喝水 300ml", [])])).toEqual([]);
  });

  it("only lets the phone withdraw a message Eris never received", () => {
    const now = 1_000_000_000;
    expect(withdrawable("retry", now, now)).toBe(true);
    expect(withdrawable("sending", now - 400_000, now)).toBe(true);
    expect(withdrawable("sending", now - 10_000, now)).toBe(false);
    expect(withdrawable("processing", 0, now)).toBe(false);
    expect(withdrawable("done", 0, now)).toBe(false);
  });

  it("tells Eris to log what the photos show and to write it down for later", () => {
    const text = runInstructions("m1", new Date("2026-11-19T07:00:00Z"));
    expect(text).toContain("照片裡看得到的食物和飲料都要記錄");
    expect(text).toContain("之後的訊息你就看不到這張照片了");
  });
});
