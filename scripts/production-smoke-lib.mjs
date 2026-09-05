/** Pure helpers for production HTML/JS smoke checks. */

export const FORBIDDEN_CLIENT_SECRETS = [
  "HERMES_API_SECRET",
  "HEALTH_IMPORT_TOKEN",
  "WIDGET_READ_TOKEN",
  "FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON",
  "x-health-signature",
];

export function extractScriptUrls(html, baseUrl) {
  const origin = new URL(baseUrl).origin;
  const urls = new Set();
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+\.js)["']/g)) {
    try {
      urls.add(new URL(match[1], origin).href);
    } catch {
      // ignore malformed URLs
    }
  }
  return [...urls];
}

export function findForbiddenSecrets(text) {
  return FORBIDDEN_CLIENT_SECRETS.filter(secret => text.includes(secret));
}

/**
 * Guard the empty-meals export regression:
 * overviews may omit entries once denormalized totals exist, so export must
 * still load per-day entries before building health-records_*.json.
 */
export function hasHistoryExportEntryLoad(text) {
  if (!text.includes("health-records_")) return false;
  if (!text.includes("schema_version")) return false;
  // Minified and source forms both keep includeEntries on overview loads.
  if (!/includeEntries\s*:\s*(?:!1|false)/.test(text)) return false;
  // Export maps selected days through an async per-day entry load.
  if (!/Promise\.all\([\s\S]{0,240}?map\(\s*async/.test(text)) return false;
  return /entries\s*:\s*[A-Za-z_$][\w$]*/.test(text);
}

export function hasImportSuccessFeedback(text) {
  return text.includes("已匯入") && text.includes("餐點") && text.includes("飲品");
}

export function evaluateClientBundles(bundleTexts) {
  const combined = bundleTexts.join("\n");
  const secrets = findForbiddenSecrets(combined);
  return {
    ok: secrets.length === 0 && hasHistoryExportEntryLoad(combined) && hasImportSuccessFeedback(combined),
    secrets,
    exportLoadsEntries: hasHistoryExportEntryLoad(combined),
    importSuccessFeedback: hasImportSuccessFeedback(combined),
    bundleCount: bundleTexts.length,
    bundleBytes: combined.length,
  };
}
