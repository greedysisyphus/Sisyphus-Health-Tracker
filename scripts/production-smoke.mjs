#!/usr/bin/env node

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

console.log(`Production smoke passed: ${response.status} ${url}`);
