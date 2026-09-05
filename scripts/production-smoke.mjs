#!/usr/bin/env node

import {
  evaluateClientBundles,
  extractScriptUrls,
} from "./production-smoke-lib.mjs";

const url = process.argv[2] ?? process.env.HEALTH_TRACKER_BASE_URL ?? "https://sisyphus-health-tracker-mu.vercel.app";

const response = await fetch(url, { redirect: "follow" });
const contentType = response.headers.get("content-type") ?? "";

if (!response.ok) {
  console.error(`Production smoke failed: ${response.status} ${response.statusText} (${url})`);
  process.exit(1);
}

if (!contentType.includes("text/html")) {
  console.error(`Production smoke failed: unexpected content-type ${contentType} (${url})`);
  process.exit(1);
}

const html = await response.text();
const scriptUrls = extractScriptUrls(html, url);
if (scriptUrls.length === 0) {
  console.error(`Production smoke failed: no client scripts found (${url})`);
  process.exit(1);
}

const bundleTexts = [];
for (const scriptUrl of scriptUrls) {
  const scriptResponse = await fetch(scriptUrl, { redirect: "follow" });
  if (!scriptResponse.ok) {
    console.error(`Production smoke failed: script ${scriptResponse.status} ${scriptUrl}`);
    process.exit(1);
  }
  bundleTexts.push(await scriptResponse.text());
}

const report = evaluateClientBundles(bundleTexts);
if (!report.ok) {
  console.error("Production smoke failed: client bundle checks");
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log(`Production smoke passed: ${response.status} ${url}`);
console.log(JSON.stringify({
  scripts: scriptUrls.length,
  bundleBytes: report.bundleBytes,
  exportLoadsEntries: report.exportLoadsEntries,
  importSuccessFeedback: report.importSuccessFeedback,
  secrets: report.secrets,
}, null, 2));
