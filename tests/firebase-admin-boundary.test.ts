import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const importLines = (source: string) =>
  source.split("\n").filter(line => /^\s*import\b/.test(line)).join("\n");

describe("firebase admin module boundary", () => {
  it("keeps firestore entry free of firebase-admin/auth so agent routes do not load jose", () => {
    const source = readFileSync(new URL("../lib/firebase-admin.ts", import.meta.url), "utf8");
    expect(importLines(source)).not.toMatch(/firebase-admin\/auth/);
    expect(importLines(source)).toMatch(/getFirestore/);
    expect(source).toMatch(/getAdminDb/);
  });

  it("loads auth from a separate module used only by history replace", () => {
    const authSource = readFileSync(new URL("../lib/firebase-admin-auth.ts", import.meta.url), "utf8");
    const historySource = readFileSync(new URL("../app/api/history/replace/route.ts", import.meta.url), "utf8");
    expect(importLines(authSource)).toMatch(/firebase-admin\/auth/);
    expect(importLines(historySource)).toMatch(/firebase-admin-auth/);
    expect(importLines(historySource)).not.toMatch(/lib\/firebase-admin["']/);
  });
});
