---
name: health-log
description: 將飲食、喝水、體重、步數與睡眠安全寫入 Jovi 的健康追蹤網站；也可查詢、更正與分析既有紀錄。
version: 1.3.0
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
6. After a successful write, call `get_daily_summary` once and reply concisely in Traditional Chinese with the change and daily calories, protein, sodium, and water. The only exception is the fast path below: it permits one confirmation call, but does not require it if the write response already returns the updated daily total.
7. Never expose `HERMES_API_SECRET`, use browser automation, or send health data anywhere except `HEALTH_TRACKER_URL`.
8. 補齊歷史營養時，先逐日呼叫 `get_daily_summary`，再以 `amend_food` 補每筆資料。包裝標示優先；無標示時可使用可信食物資料庫或合理份量估算，必須標為 `ai_estimated` 與 `low`／`medium` 信心，並在回覆中說明。
9. **純白水一律使用 `log_water`**；這是最快、最直接的登記方式。其他可飲用的非酒精飲品（無糖茶、咖啡、Coke Zero、牛奶、豆漿等）則在 `log_food` 的同一筆 entry 填入 `hydrationMl`，把實際可飲用容量計入「水分（含飲品）」。同一份飲品不可同時 `log_food` 和 `log_water`，避免重複計算。未知容量時先詢問；若使用者同意估算，清楚標示估算依據（例如常見 Coke Zero 罐 330 ml）。
10. 使用者說「常用食物」、「我的食物」或已知固定食物時，先呼叫 `find_foods` 搜尋現有資料；有精確命中時優先使用該營養資料。使用者明確要求儲存時，以 `upsert_food` 登記名稱、基準份量、營養、品牌與分類。

## Photo meal workflow — 多張餐點照片

當使用者在同一則 Discord 訊息附上 1–10 張圖片，並說明「請分析／記錄」、「早餐／午餐／晚餐」或明確表示要登記時，將所有附圖視為**同一餐的資料組**。不要逐張各自當成一餐，也不要把同一食物的餐點照與營養標示重複登記。

1. 先檢視該則訊息的所有圖片一次，辨識每張照片的角色：完整餐點、包裝正面、營養標示、剩餘食物／實際食用份量。每張圖最多使用一次 `vision_analyze`；不可反覆辨識同一張圖。
2. 優先使用清楚可讀的包裝營養標示；依使用者實際吃下的比例換算。這類 entry 設為 `source: package_label`、`confidence: high`。
3. 沒有標示的餐點，依照片可見內容與合理份量估算熱量、蛋白質、碳水、脂肪與鈉；entry 設為 `source: ai_estimated`、`confidence: medium` 或 `low`，並在 `notes` 說明估算依據。不可把估算寫成精確值。
4. **嚴禁使用 `web_search`、瀏覽器、自動搜尋店家菜單、舊對話或檔案。** 照片和訊息已足夠時直接估算；不夠時先問**一個最必要的問題**。若使用者已說「全部吃完」或照片顯示明確包裝份量，毋須再問。
5. 將整餐的所有食物整理為同一次 `log_food` 的 `entries` 陣列，一次寫入；最多再呼叫一次 `get_daily_summary` 確認。不可對每一張圖片各做一次 API 寫入，也不可在寫入前反覆讀取摘要。
6. 回覆必須列出辨識到的食物、每項是「標示值」或「照片估算」、以及當日總計。照片估算要用「約」並提醒可能有誤差。
7. 如果使用者只傳照片、沒有說要分析或記錄，先問「要我分析並記錄這餐嗎？」；不要自行寫入。
8. 照片餐點的整體上限是：每張圖一次視覺辨識 + 一次 `log_food` + 一次確認。超出此上限時停止並直接回覆目前可得的估算或提出一個問題，不可繼續工具迴圈。

## Fast path — 水與簡單飲品

當訊息只是在登記白水、簡單飲品或清楚份量的湯品時，優先採取這個流程。這是寫入任務，不是分析任務：**不搜尋網路、不搜尋舊對話／檔案、不做自我改進、不主動分析，也不先讀取當日摘要。**

1. 解析日期與容量；未指定日期時使用 Asia/Taipei 今天。
2. 純白水：只呼叫一次 `log_water`，例如 `1500 ml` 就使用 `addMl: 1500`。
3. 湯品：用一次 `log_food` 建立湯品食物紀錄，並以 `hydrationMl` 計入使用者明說的湯量。若沒有包裝／菜單資料，使用保守估算、`source: ai_estimated`；不要為了估營養而搜尋網路。
4. 若一句話同時有白水與湯品，例如「喝 1500 ml 水，加一碗味噌湯約 200 ml」，只做兩次寫入：一次 `log_water` 加 1500 ml，另一次 `log_food` 加「味噌湯」且 `hydrationMl: 200`。之後最多一次 `get_daily_summary` 確認即可。
5. 若是已知容量的零熱量飲料，建立一筆 `log_food`（0 kcal）並填寫 `hydrationMl`；未知容量時才問一次容量，不能反覆查詢或猜測。
6. 回覆只需確認新增內容與今日水分總計。整個流程最多 **2 次寫入 + 1 次確認**，不可因為這類簡單紀錄而進行額外工具呼叫。

## Quick Reference

- `log_food`: add one or more meal entries.
- `amend_food`: change a known `entryId`.
- `delete_food`: delete a known `entryId` after confirmation.
- `upsert_food`: save a frequently used food to the personal food library.
- `find_foods`: 搜尋個人常用食物資料庫。
- `log_water`: add water in millilitres; never overwrite a previous amount.
- `log_body`: log any provided weight, waist, body-fat percentage, sleep hours, steps, or note.
- `get_daily_summary`: read the source-of-truth daily entries and totals.
- `get_range_summary`: 讀取 1–90 天的每日總計、食物明細、飲水、體重與步數；這是進行週期／趨勢分析時的唯一資料來源。
- `import_history`: 一次匯入舊資料。JSON 放在 `data` 內，保留所有食物名稱／份量；缺少營養標示的食物以 0 記錄並標為低信心，不能自行假造精確營養數字。
- `shift_imported_history`: 僅限修正剛匯入的整批歷史資料日期。必須明確列出來源日期、飲水日期、身體資料日期，以及需要保留原日期的既有資料；不可用於一般日常紀錄。

`log_food` 的每筆 entry 必須把營養值放在 `nutrition` 物件內；API 會將其中數值乘以 `portion` 後儲存。因此，若 `portion` 使用 200 ml，`nutrition` 必須填「每 1 ml」數值；若已算好整份營養，優先令 `portion: 1`、用 `unit`／`notes` 描述實際份量，避免被重複放大。

`amend_food` 的 `changes.nutrition` 是「這次最終吃下的整份營養值」，不必也不可再乘以 `portion`。

`hydrationMl` 是該筆飲品對每日總水分的貢獻；更正或刪除飲品時，API 會自動同步調整總水分。

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
