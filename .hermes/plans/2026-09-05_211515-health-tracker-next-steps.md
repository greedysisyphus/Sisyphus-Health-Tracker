# Sisyphus Health Tracker — Next Steps Implementation Plan

> **For Hermes:** Use the repository PR workflow to implement this plan task-by-task. Keep each slice independently tested and shippable.

**Goal:** 在目前 production 穩定、CI／Vercel protection 完整的基礎上，降低 dependency risk、補齊可觀測性，並改善健康資料匯入與日常操作的可靠度。

**Architecture:** 維持 Next.js App Router + Firebase Admin／Firestore + Vitest。所有 server-side data mutation 維持既有 authenticated／atomic path；每個變更使用 feature branch → PR → `Verify` + Vercel → squash merge，避免直接推送 `main`。

**Tech Stack:** Next.js 16.3.4、React 19、Firebase Admin 14.3.0、Zod、Vitest、GitHub Actions、Vercel。

---

## Current baseline

- `main` 已啟用 branch protection：required `Verify` 與 `Vercel`、PR、strict checks、禁止 force-push／刪除。
- Production deployment 與 HTTP smoke 已驗證成功。
- CI：59 tests、TypeScript、lint、build 全部通過。
- 已升級 Next.js 16.3.4 與 Firebase Admin 14.3.0。
- `npm audit --omit=dev`：0 high、6 moderate；不要使用 `npm audit fix --force`。
- Apple Health import 已具備 transaction、syncId replay/conflict、stale sync 與 daily/body dual-write。
- History export round-trip、daily summaries、saved-food indexed search 與 migration 已有 route-level coverage。

---

## Phase 1 — Dependency maintenance automation (P1)

### Task 1: Add Dependabot version-update policy

**Objective:** 讓非安全 dependency updates 也能以小型 PR 進入既有 CI／Vercel gate。

**Files:**
- Create: `.github/dependabot.yml`

**Implementation:**
- ecosystem：`npm`
- directory：`/`
- schedule：`weekly`
- open-pull-requests-limit：`3`
- commit-message prefix：`deps`
- 不自動合併；所有 PR 仍需 `Verify` 與 `Vercel`。

**Validation:**
- YAML parse succeeds。
- GitHub repository 顯示 Dependabot version-update configuration enabled。
- 不產生 secrets 或 token。

**Commit:** `chore: configure Dependabot updates`

### Task 2: Review remaining production audit advisories

**Objective:** 將 6 個 moderate advisory 分成可修 patch 與需升級／接受風險的項目。

**Files:**
- Modify only if a safe patch is identified: `package.json`, `package-lock.json`
- Create if useful: `docs/dependency-risk-register.md`

**Steps:**
1. 執行 `npm audit --omit=dev --json` 並保留 advisory URL、affected package、fix availability。
2. 先測試 semver-compatible updates；不要以 `--force` 解決。
3. 每次只升級一組相關套件。
4. 跑 full gate 與 production smoke。
5. 對沒有低風險修法的 moderate advisory 記錄原因與 recheck trigger。

**Acceptance:**
- high／critical 維持 0。
- 每個剩餘 moderate 都有明確處置：修復、transitive 等待 upstream，或風險接受。

---

## Phase 2 — Production observability and smoke coverage (P1)

### Task 3: Add authenticated production smoke script

**Objective:** 將目前手動的 production HTTP／API readback 變成可重複執行的 non-mutating smoke check。

**Files:**
- Create: `scripts/production-smoke.mjs` 或 repository 採用的等價 script
- Modify: `package.json`
- Document: `README.md` 或 `docs/operations.md`

**Rules:**
- 預設只檢查 public `GET /` HTTP 200 與必要 response headers。
- Agent／Health import API 不在 CI 中寫入資料。
- 若需要 private API check，只接受 environment-provided credentials；不得寫入 JSON、log 或 commit。
- script 失敗時輸出 endpoint／status，不輸出 secret。

**Validation:**
- 本機 production smoke 通過。
- 缺少 private credentials 時明確 skip，不假裝成功。
- 對 HTTP non-2xx 有 deterministic failure。

### Task 4: Add request correlation and safe error observability

**Objective:** 讓 Agent、Apple Health import、Widget failure 能被定位，但不洩漏健康資料或 secrets。

**Files:**
- Modify: `app/api/agent/route.ts`
- Modify: `app/api/health/import/route.ts`
- Modify: `app/api/widget/today/route.ts`
- Test: corresponding route test files

**Rules:**
- 產生／傳遞 request ID。
- log 只包含 action、status、request ID、elapsed time；不包含 payload、HMAC、Bearer token、完整 Firestore data。
- response 保持既有 contract，不把 internal errors 暴露給 client。

**Acceptance:**
- success／validation／operation failure 都可透過 request ID 關聯。
- tests assert secret and sensitive payload fields never appear in logged error output。

---

## Phase 3 — Reliability regression matrix (P1/P2)

### Task 5: Complete Widget and body-metric fallback coverage

**Objective:** 保證 bodyLogs 優先、dailyLogs fallback 的規則在 Widget、Agent summary、Web overview 一致。

**Files:**
- Test/modify: `tests/widget-route.test.ts`
- Test/modify: `tests/agent-route.test.ts`
- Test: `tests/daily-summary.test.ts`
- Reference: `lib/agent-health.ts`, `lib/daily-summary.ts`

**Cases:**
- bodyLogs 有 weight／steps 時優先。
- bodyLogs 缺欄位時各欄位 individually fallback 到 dailyLogs。
- 只有 weight-only day 時不污染 food overview。
- 無資料時回傳既有 nullable／undefined contract。

**Acceptance:**
- 每個 consumer 使用同一個 resolver 或同等明確的共享 helper。
- full test/build gate 通過。

### Task 6: Add history import round-trip semantic assertions

**Objective:** 除了確認 request 被接受，也確認 export 後再 replace 不會改變核心資料語意。

**Files:**
- Modify: `tests/agent-route.test.ts`
- If extraction is needed: `lib/history-export.ts`, `app/page.tsx`

**Cases:**
- servings／quantity、nutrition totals、beverage hydration、meal type。
- null water with `preserveExistingWaterDates`。
- empty meals／beverages。
- legacy imported data remains searchable and summarized。

**Acceptance:**
- Test fixture follows Web `schema_version: "3.0"` shape。
- No production write used by tests.

---

## Phase 4 — Product UX improvements (P2)

### Task 7: Improve saved-food search and editor feedback

**Objective:** 讓 indexed search 的 loading、empty、legacy fallback 與 save error 在 UI 上可理解。

**Files:**
- Modify: `app/page.tsx`
- Modify: `services/health-service.ts`
- Test where practical: component/helper tests

**Acceptance:**
- search loading 不會顯示 stale results 為最新結果。
- empty query、no result、network failure 有不同 feedback。
- save／merge／delete 失敗不會靜默吞掉。
- mobile sheet primary action 仍固定在 sticky footer。

### Task 8: Add import/export user-facing validation

**Objective:** 在瀏覽器匯入前提供 schema version、日期範圍與資料筆數檢查，減少不可逆 replace 誤操作。

**Files:**
- Modify: `app/page.tsx`
- Add pure helper/test: `lib/history-export.ts`, `tests/history-export.test.ts`

**Rules:**
- 不改既有 `replace_history_export` server contract。
- 匯入前顯示日期範圍、entries count、water/body impact。
- replace 是 destructive scope；需要明確 confirmation。
- invalid JSON／unsupported schema version 不送 request。

**Acceptance:**
- export → browser parse → preview → replace test path covered。
- 使用者取消時 zero writes。

---

## Delivery protocol for every task

1. 從乾淨 `main` 建 feature branch。
2. 先寫 focused failing test（若是 code behavior change）。
3. 執行 targeted test 確認 RED。
4. 實作最小變更，確認 GREEN。
5. 執行完整 gate：
   - `npm test`
   - `npx tsc --noEmit`
   - `npm run lint`
   - `npm run build`
   - `git diff --check`
6. 執行適用的 audit／production smoke；secret 僅由 environment 提供。
7. commit、push、建立 PR，base 必須是 `main`。
8. 等待 required `Verify` 與 `Vercel`，squash merge。
9. `git switch main && git pull --ff-only origin main`；若本機有被 squash 取代的 commit，先確認內容一致，再取得使用者對 destructive pointer cleanup 的明確同意。
10. 最後 readback：remote SHA、CI conclusion、Vercel deployment、production HTTP。

## Recommended order

1. Task 1：Dependabot version updates（低風險、立即提升維運）。
2. Task 2：moderate audit risk register／安全 patch review。
3. Task 3：production smoke script。
4. Task 5：body-metric fallback regression matrix。
5. Task 4：safe request observability。
6. Task 6：history semantic round-trip。
7. Task 7–8：UI／import confirmation。

## Risks and explicit non-goals

- 不在沒有明確日期清單時執行 production backfill。
- 不在 CI 自動寫入 Firestore health data。
- 不使用 `npm audit fix --force` 作為安全策略。
- 不把 HMAC、Bearer token、Firebase service account 或健康 payload 寫入 repo、logs、issue 或 PR。
- 不因追求 coverage 而重寫已穩定的 Apple Health atomic import path。
- 不把 Vercel preview success 誤稱為 production success；兩者分開 readback。
