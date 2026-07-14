---
name: health-log
description: 將飲食、喝水、體重、步數與睡眠安全寫入 Jovi 的健康追蹤網站；也可查詢、更正與分析既有紀錄。
version: 1.1.0
author: Jovi
platforms: [macos]
required_environment_variables:
  - name: HEALTH_TRACKER_URL
    prompt: Health Tracker API URL
    help: Vercel 網站的 /api/agent 網址
    required_for: full functionality
  - name: HERMES_API_SECRET
    prompt: Health Tracker API secret
    help: 與 Vercel HERMES_API_SECRET 相同的值
    required_for: full functionality
metadata:
  hermes:
    tags: [health, food, nutrition, water, weight, Discord]
    requires_toolsets: [terminal]
---

# Health Log Skill

將飲食、喝水、體重、睡眠與步數寫入 Jovi 的健康追蹤網站。每次使用都必須透過 `terminal` 執行此 skill 內的 API 腳本；只用文字回覆不算完成紀錄。

## When to Use

使用者回報、修正、查詢或要求分析健康資料時使用，包括食物、營養、喝水、體重、睡眠與步數。

## Prerequisites

- `HEALTH_TRACKER_URL` 與 `HERMES_API_SECRET` 必須位於 `~/.hermes/.env`。
- 透過 `terminal` 執行 `scripts/health_api.py`，不要改用瀏覽器自動化。

## How to Run

從 health-log skill 目錄執行下列模式；先完成 API 寫入，再以成功回應為準回覆使用者：

```bash
printf '%s' '<JSON>' | python3 scripts/health_api.py
```

## Rules

1. **所有紀錄或修正都必須用 `terminal` 執行 `scripts/health_api.py`。沒有成功的 API JSON 回應時，不可以說「已記錄」。**
2. Use `Asia/Taipei` for dates. If the user does not specify a date, use today.
3. Prefer a package nutrition label. Restaurant information is second-best. Photos and restaurant meals without a label are estimates and must set `source` to `ai_estimated` and explain assumptions in the Discord response.
4. Before `amend_food` or `delete_food`, call `get_daily_summary`, identify the exact `entryId`, and tell the user which entry will change. Ask a follow-up question if more than one entry might match.
5. For a portion correction, recalculate calories, protein, carbs, fat, sugar, fiber, saturatedFat, and sodium for the final consumed portion before using `amend_food`.
6. After a successful write, call `get_daily_summary` and reply concisely in Traditional Chinese with the change and daily calories, protein, sodium, and water.
7. Never expose `HERMES_API_SECRET`, use browser automation, or send health data anywhere except `HEALTH_TRACKER_URL`.
8. 補齊歷史營養時，先逐日呼叫 `get_daily_summary`，再以 `amend_food` 補每筆資料。包裝標示優先；無標示時可使用可信食物資料庫或合理份量估算，必須標為 `ai_estimated` 與 `low`／`medium` 信心，並在回覆中說明。

## Quick Reference

- `log_food`: add one or more meal entries.
- `amend_food`: change a known `entryId`.
- `delete_food`: delete a known `entryId` after confirmation.
- `upsert_food`: save a frequently used food to the personal food library.
- `log_water`: add water in millilitres; never overwrite a previous amount.
- `log_body`: log any provided weight, waist, body-fat percentage, sleep hours, steps, or note.
- `get_daily_summary`: read the source-of-truth daily entries and totals.
- `get_range_summary`: 讀取 1–90 天的每日總計、食物明細、飲水、體重與步數；這是進行週期／趨勢分析時的唯一資料來源。
- `import_history`: 一次匯入舊資料。JSON 放在 `data` 內，保留所有食物名稱／份量；缺少營養標示的食物以 0 記錄並標為低信心，不能自行假造精確營養數字。
- `shift_imported_history`: 僅限修正剛匯入的整批歷史資料日期。必須明確列出來源日期、飲水日期、身體資料日期，以及需要保留原日期的既有資料；不可用於一般日常紀錄。

`amend_food` 的 `changes.nutrition` 是「這次最終吃下的整份營養值」，不必也不可再乘以 `portion`。

## Analysis

使用者要求「分析」、「週報」、「趨勢」或「這幾天吃得如何」時，先以 `get_range_summary` 取得指定日期（未指定則最近 7 天，最多 90 天）。只根據回傳資料分析，清楚說明缺漏紀錄或估算值會降低結論可信度；分別比較熱量、蛋白質、纖維、鈉、飲水、體重與步數，再提供 2–4 個可執行的建議。這是一般營養紀錄建議，不要做疾病診斷或替代醫療建議。

## Procedure

1. 從使用者訊息判讀動作與日期；未指定日期時用 Asia/Taipei 的今天。
2. 以 `terminal` 執行 API 腳本，將正確 JSON 傳入。
3. 寫入成功後呼叫 `get_daily_summary` 確認當日總計。
4. 用繁體中文簡短回覆實際寫入結果；若 API 失敗，清楚說明失敗原因，不要假裝已完成。

## Examples

```bash
printf '%s' '{"action":"log_water","date":"2026-07-14","addMl":500}' | python3 scripts/health_api.py
```

```bash
printf '%s' '{"action":"log_body","date":"2026-07-14","weightKg":74.2,"steps":6693}' | python3 scripts/health_api.py
```

```bash
python3 scripts/health_api.py --file /absolute/path/to/health-history.json
```

`health-history.json` 的最外層必須是：

```json
{ "action": "import_history", "data": { "records": [] } }
```

## Verification

成功的 API 回應會是 JSON，包含 `ok: true`。若回應錯誤，先處理錯誤再回覆使用者。
