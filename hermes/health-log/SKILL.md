---
name: health-log
description: 將飲食、飲水、體重、睡眠與步數安全寫入 Jovi 的健康追蹤網站；支援 Discord 冪等、防重複、照片餐點、修正與趨勢分析。
version: 2.0.0
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

# Health Log

所有健康紀錄都必須透過本 skill 的腳本寫入網站。文字回覆不代表完成；只有 API 回傳 `ok: true` 才能說已記錄。

## Intent router

| 使用者需求 | 執行方式 |
|---|---|
| 新增食物、飲品、白水或身體資料 | 一次 `log_health_event`，使用 `scripts/health_log.py` |
| 查詢某日 | `get_daily_summary` |
| 週期／趨勢分析 | `get_range_summary` |
| 更正既有食物 | 先查摘要定位 `entryId`，再 `amend_food` |
| 刪除食物 | 先查摘要、向使用者確認 exact entry，再 `delete_food` |
| 常用食物 | 先 `find_foods`，明確要求儲存才 `upsert_food` |
| 歷史營養補齊 | 載入 `references/history-nutrition-backfill.md` |
| 照片餐點 | 載入 `references/photo-meal-workflow.md` |

讀取與修正可將原始 `action` JSON 傳給 `health_log.py`；腳本會轉交 `health_api.py`。

## Safe write path

Discord 新增紀錄時，把 triggering message ID 當作 `eventId`，並將同一則訊息中的食物、飲品、白水與身體資料組成一個事件：

```bash
python3 scripts/health_log.py <<'EOF'
{
  "intent": "log_health_event",
  "date": "today",
  "eventId": "DISCORD_MESSAGE_ID",
  "entries": [],
  "plainWaterMl": 500
}
EOF
```

API 會以 `source + eventId + operationKey` 防重複，並以 transaction 一次寫入整個事件。相同內容重送時回傳 `replayed: true`；同一 key 但內容不同時回傳 `idempotency_conflict`，此時不可改 key 來繞過保護，應改用明確的更正流程。

成功回應已包含伺服器端 `dailySummary`。直接用它回覆，不要自行重算，也不必再呼叫 `get_daily_summary`。

## Non-negotiable rules

1. 未指定日期時使用 Asia/Taipei 今天；不得猜 UTC 日期。
2. 純白水放在事件的 `plainWaterMl`。其他非酒精飲品建立 food entry 並填 `hydrationMl`；同一飲品不可再加到 `plainWaterMl`。
3. 營養全部是**每份**數字，以 `servings` 表示吃了幾份。包裝標示一份但只吃一半時保留標示值並用 `servings: 0.5`。
4. 優先序：包裝標示 > 餐廳官方 > 個人常用食物 > 合理 AI 估算。無標示估算必須用 `ai_estimated` 與 `medium`／`low`，並在 `notes` 和回覆說明假設。
5. 不可暴露 `HERMES_API_SECRET`、使用瀏覽器寫入，或把健康資料送往 `HEALTH_TRACKER_URL` 以外。
6. API 失敗、回傳非 `ok: true` 或 `idempotency_conflict` 時，清楚報錯，不能假裝完成。

## Food entry contract

完整 schema 見 `references/api-schema.md`。每筆至少提供：

- `name`, `meal`, `servings`, `nutrition`
- `brand`, `category`, `servingWeightG`, `notes`；未知填 `null`
- `hydrationMl`；非飲品通常為 0
- `source`, `confidence`

`meal` 僅可為：早餐、午餐、晚餐、點心、飲料、宵夜、其他。

## Corrections and invariants

`amend_food` 前必須：

1. 呼叫 `get_daily_summary`。
2. 以日期與 exact `entryId` 定位；同名而無法確認時先問使用者。
3. 告知使用者將修改哪一筆。
4. 只傳需要修改的欄位。

一般更正只允許：`nutrition`, `servings`, `servingWeightG`, `source`, `confidence`, `notes`, `hydrationMl`。名稱、日期、meal、time 與 entry ID 不可透過 amend 修改。歷史補營養使用 `mode: history_backfill`，只允許 `nutrition`, `source`, `confidence`, `notes`。

## Response

繁體中文簡短回覆：

- 實際新增／修改內容
- 標示值或 AI 估算及必要假設
- `dailySummary` 的熱量、蛋白質、鈉、水分
- 必要時補充咖啡因或安全提醒

伺服器已回傳的數字是唯一來源，不要在回覆時重新計算。

## Verification checklist

- [ ] API 回傳 `ok: true`
- [ ] 新增紀錄帶 Discord `eventId`
- [ ] 食物與白水同訊息時使用單一複合事件
- [ ] 飲品 hydration 沒有與 plain water 重複
- [ ] 回覆使用 API `dailySummary`
- [ ] 估算值標示 source、confidence 與 assumptions
