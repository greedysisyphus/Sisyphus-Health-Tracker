# Hermes × 日常營養

Hermes 不操作網站畫面；它將整理好的資料送到私有 API。這可維持一致格式、避免重複寫入，也不需要把 Firebase 管理權限交給 Hermes。

## Hermes 環境變數

在 Hermes 主機的 `~/.hermes/.env` 設定：

```bash
HEALTH_TRACKER_URL=https://YOUR-APP.vercel.app/api/agent
HERMES_API_SECRET=與 Vercel 相同的一串隨機密鑰
```

`HERMES_API_SECRET` 只存在 Hermes 主機與 Vercel；不可傳到 Discord、GitHub 或瀏覽器。

## 安裝與更新 Skill

將專案中的 `hermes/health-log/` 複製到 Hermes 主機的 `~/.hermes/skills/health-log/`。必須保留：

- `SKILL.md`
- `scripts/health_log.py`
- `scripts/health_api.py`
- `references/`

日常操作一律透過 `health_log.py`。`health_api.py` 是底層傳輸程式，不應直接用它新增白水、食物或身體資料，否則會繞過防重複保護。

## 唯一的日常新增寫入方式

同一則 Discord 訊息中的食物、飲品、白水與身體資料，必須合併為一個 `log_health_event`。把 Discord message ID 放入 `eventId`：

```bash
python3 scripts/health_log.py <<'EOF'
{
  "intent": "log_health_event",
  "date": "today",
  "eventId": "DISCORD_MESSAGE_ID",
  "entries": [
    {
      "name": "光泉無加糖黑豆漿",
      "brand": "光泉",
      "category": "豆類",
      "meal": "早餐",
      "servings": 1,
      "hydrationMl": 400,
      "nutrition": { "calories": 142, "protein": 14, "carbs": 5.2, "fat": 7.2, "sodium": 56 },
      "source": "nutrition_label",
      "confidence": "high"
    }
  ],
  "plainWaterMl": 500
}
EOF
```

`date: "today"` 會依 Asia/Taipei 轉換日期。相同 `eventId` 重送時，API 會回傳原本結果與 `replayed: true`，不會再新增一次資料。成功回應中的 `dailySummary` 是 Hermes 回覆使用者時唯一應採用的累計數字。

### 水分規則

- 純白水：只放 `plainWaterMl`。
- 飲料、豆漿、咖啡、湯品：建立 food entry，並填該次的 `hydrationMl`。
- 同一飲品不可同時填 `hydrationMl` 與 `plainWaterMl`。

## 讀取、更正與常用食物

透過 `health_log.py` 傳入原始 `action` JSON：

- `get_daily_summary`：讀取某日。
- `get_range_summary`：分析一段日期，僅讀取。
- `amend_food`：先讀取摘要並用精確 `entryId` 更正。
- `delete_food`：先讀取摘要、確認精確項目後才刪除。
- `find_foods`、`upsert_food`：查詢或在使用者明確要求時儲存常用食物。

一般 `amend_food` 只可更新營養、份數、食用百分比、每份重量、水分、來源、信心度與備註。不可改日期、名稱、餐次、時間或 `entryId`。

## 已淘汰的日常寫入 action

`log_food`、`log_water`、`log_body` 是早期端點，沒有 Discord event 的冪等保護。它們不可以被 Hermes Skill 使用；`health_log.py` 會直接拒絕。舊端點暫時只保留給既有遷移工具相容，日常紀錄一律用 `log_health_event`。

歷史匯入、日期平移與覆蓋匯入是一次性遷移工具，不屬於日常 Hermes 對話流程；執行前必須先備份並取得使用者明確同意。

## API 簽章

每個請求須帶：

```text
x-health-timestamp: Unix milliseconds
x-health-signature: HMAC-SHA256("{timestamp}.{raw JSON body}")
```

請求五分鐘後失效。API 永遠寫入 `HEALTH_TRACKER_OWNER_ID` 對應的帳號，請求不可指定任意使用者。
