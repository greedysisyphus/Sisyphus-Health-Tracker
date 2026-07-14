# Hermes × 日常營養

Hermes 不應操作網站畫面；它應將整理好的資料送到網站 API。這樣資料有一致的格式、能修正舊紀錄，也不需要把 Firebase 管理權限交給 Hermes。

## Hermes 環境變數

在 Hermes 主機的 `~/.hermes/.env` 設定：

```bash
HEALTH_TRACKER_URL=https://YOUR-APP.vercel.app/api/agent
HERMES_API_SECRET=與 Vercel 相同的一串隨機密鑰
```

`HERMES_API_SECRET` 只存在 Hermes 主機與 Vercel；不可傳到 Discord、GitHub 或瀏覽器。

## 安裝 Hermes skill

此專案已提供可安裝的 skill 與送出工具。將 `hermes/health-log/` 複製到 Hermes 主機的 `~/.hermes/skills/health-log/`，並保留 `SKILL.md` 與 `scripts/health_api.py` 的相對位置。

## API 簽章

每個請求須為 JSON，並包含以下 headers：

```text
x-health-timestamp: Unix milliseconds
x-health-signature: HMAC-SHA256("{timestamp}.{raw JSON body}")
```

請求在五分鐘後失效。API 的資料永遠寫進 `HEALTH_TRACKER_OWNER_ID` 對應帳號，不能由請求本身指定使用者。

## 常用 payload

### 記錄食物

```json
{
  "action": "log_food",
  "date": "2026-07-14",
  "entries": [{
    "name": "光泉無加糖黑豆漿",
    "meal": "早餐",
    "nutrition": { "calories": 142, "protein": 14, "carbs": 5.2, "fat": 7.2, "sodium": 56 },
    "portion": 1,
    "unit": "瓶",
    "time": "08:30",
    "source": "nutrition_label",
    "confidence": "high"
  }]
}
```

### 補登喝水與體重

```json
{ "action": "log_water", "date": "2026-07-14", "addMl": 500 }
```

```json
{ "action": "log_body", "date": "2026-07-14", "weightKg": 74.2, "steps": 6693 }
```

### 修正食物

先讀取 `get_daily_summary`，再使用精確的 `entryId`：

```json
{
  "action": "amend_food",
  "date": "2026-07-14",
  "entryId": "要修改的紀錄 ID",
  "changes": { "portion": 0.5, "unit": "份" }
}
```

## Hermes 用戶端腳本

內附的 `scripts/health_api.py` 只讀取 `HEALTH_TRACKER_URL` 和 `HERMES_API_SECRET`，依上方規格計算 HMAC 後送出 JSON。不要將密鑰寫入腳本或技能檔。

> 重要：目前 API 的 `amend_food` 會更新提供的欄位。若變更份量，Hermes 必須連同重新計算後的營養值一併送出，或改為刪除舊紀錄後重新以正確份量寫入。
