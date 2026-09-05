import { describe, expect, it } from "vitest";
import {
  evaluateClientBundles,
  extractScriptUrls,
  findForbiddenSecrets,
  hasHistoryExportEntryLoad,
  hasImportSuccessFeedback,
} from "../scripts/production-smoke-lib.mjs";

describe("production smoke helpers", () => {
  it("extracts absolute script URLs from HTML", () => {
    const html = `
      <script src="/_next/static/chunks/app.js"></script>
      <link rel="preload" href="https://cdn.example/_next/static/chunks/vendor.js" as="script" />
    `;
    expect(extractScriptUrls(html, "https://sisyphus-health-tracker-mu.vercel.app")).toEqual([
      "https://sisyphus-health-tracker-mu.vercel.app/_next/static/chunks/app.js",
      "https://cdn.example/_next/static/chunks/vendor.js",
    ]);
  });

  it("rejects client bundles that leak server secrets", () => {
    expect(findForbiddenSecrets("const x = 'HERMES_API_SECRET'")).toContain("HERMES_API_SECRET");
    expect(findForbiddenSecrets("safe client code")).toEqual([]);
  });

  it("accepts the fixed export path that loads entries after overview totals", () => {
    const fixed = `
      const days = await listDailyOverviews(uid, 365, { includeEntries: !1 });
      const records = await Promise.all(days.map(async day => {
        const loaded = await listDailyEntries(uid, day.date);
        return buildHistoryExportDay({ date: day.date, waterMl: day.waterMl, entries: loaded });
      }));
      link.download = \`health-records_\${start}_to_\${end}.json\`;
      payload.schema_version = "3.0";
    `;
    expect(hasHistoryExportEntryLoad(fixed)).toBe(true);
  });

  it("rejects the empty-meals regression that maps overview entries without a per-day load", () => {
    const broken = `
      const days = await listDailyOverviews(uid, 365);
      const records = days.map(day => ({
        date: day.date,
        meals: day.entries.filter(Boolean),
        beverages: [],
      }));
      link.download = \`health-records_\${start}_to_\${end}.json\`;
      payload.schema_version = "3.0";
    `;
    expect(hasHistoryExportEntryLoad(broken)).toBe(false);
  });

  it("requires import success feedback copy in the client bundle", () => {
    expect(hasImportSuccessFeedback("已匯入 2026-09-01 至 2026-09-05（2 天、餐點 2 筆、飲品 1 杯）。")).toBe(true);
    expect(hasImportSuccessFeedback("已匯入 2 天的歷史資料。")).toBe(false);
  });

  it("aggregates bundle checks", () => {
    const okBundle = `
      includeEntries:!1
      await Promise.all(selected.map(async day => {
        const i = await load(day.date);
        return { entries:i };
      }))
      health-records_
      schema_version
      已匯入 範圍（餐點 1 筆、飲品 1 杯）
    `;
    expect(evaluateClientBundles([okBundle])).toMatchObject({
      ok: true,
      secrets: [],
      exportLoadsEntries: true,
      importSuccessFeedback: true,
    });

    expect(evaluateClientBundles(["HERMES_API_SECRET health-records_ schema_version includeEntries:!1 await Promise.all(x.map(async y => ({entries:z}))) 已匯入 餐點 飲品"])).toMatchObject({
      ok: false,
      secrets: ["HERMES_API_SECRET"],
    });
  });
});
