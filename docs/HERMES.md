# Hermes × 日常營養

Hermes 不操作網站畫面；它將整理好的資料送到私有 API。這可維持一致格式、避免重複寫入，也不需要把 Firebase 管理權限交給 Hermes。

## Hermes 環境變數

在 Hermes 主機的 `~/.hermes/.env` 設定：

```bash
HEALTH_TRACKER_URL=https://YOUR-APP.vercel.app/api/agent
HERMES_API_SECRET=與 Vercel 相同的一串隨機密鑰
```

`HERMES_API_SECRET` 只存在 Hermes 主機與 Vercel；不可傳到 Discord、GitHub 或瀏覽器。

### 第二位使用者（需先建立自己的 Firebase 帳號）

先讓第二位使用者登入網站，從 Firebase Authentication 取得她自己的 UID。部署環境設定 `HEALTH_TRACKER_SECONDARY_OWNER_ID` 為該 UID，另以獨立隨機密鑰設定 `HERMES_SECONDARY_API_SECRET`（不可與原密鑰相同）。沒有 UID 時不要設定假的值；第二位使用者的 API 請求會被拒絕。原本的 `HEALTH_TRACKER_OWNER_ID` 和 `HERMES_API_SECRET` 不變。

第二位使用者的 Hermes 執行環境單獨設定 `HEALTH_TRACKER_URL`、`HERMES_API_SECRET`（值為部署端的 `HERMES_SECONDARY_API_SECRET`）及 `HEALTH_TRACKER_AGENT_ID=secondary`；不可把原使用者的密鑰交給這個環境。`health_api.py` 會送出 `x-health-identity: secondary`，伺服器以該身份選擇**對應密鑰和預先設定的 UID**，不接受請求指定 UID。若共用同一 Hermes 實例，必須確保每位使用者的執行環境和密鑰隔離；單靠對話提示詞不能隔離密鑰或身份。網站儀表板仍由 Firebase 登入身份讀取各自 `users/{uid}` 資料。

### 網站聊天頁（`/chat`，Eris）

第二位使用者可以不用 Discord，直接在網站的 `/chat` 傳文字或多張照片。網站收到後替她在 Hermes 開一個背景工作（`POST /v1/runs`，`Idempotency-Key` 為訊息 ID），Hermes 一收下就回覆手機「已送出」，之後她可以關掉 App；Hermes 照 `health-log` 寫入，`eventId` 用同一個訊息 ID、`source` 為 `dashboard`，重送不會重複記錄。對話紀錄存在 `users/{uid}/chatMessages`，只存縮圖，不存原圖。

部署端另外設定（缺任何一個，她的聊天頁會顯示「還沒開通」）：

```text
HERMES_SECONDARY_CHAT_URL=https://<Hermes 對外網址>/p/<她的 profile>
HERMES_SECONDARY_CHAT_KEY=<她 profile 的 API_SERVER_KEY，至少 32 字元>
```

Hermes 端：她有自己的 profile（`hermes profile create <名稱> --clone`），其 `.env` 只放她的 `HERMES_API_SECRET`（= 部署端 `HERMES_SECONDARY_API_SECRET`）、`HEALTH_TRACKER_AGENT_ID=secondary` 和她自己的 `API_SERVER_KEY`；記憶庫（hindsight bankId）要和原使用者分開；`platform_toolsets.api_server` 只開 `terminal, skills, vision, memory`。她的終端機要用沙盒（`terminal.backend: docker`、`docker_image: python:3.12-slim`），否則她那份 Hermes 以 root 執行時讀得到主 profile 的 `.env`；開發用外掛（ponytail、orca-status 等）在她的 profile 關掉，`memories/` 不要沿用原使用者的。主 `.env` 需 `API_SERVER_ENABLED=true` 和主 profile 自己的 `API_SERVER_KEY`。對外只開 `/p/<她的 profile>` 這個路徑，主 profile 不對外。

Hermes 只會把 skill 宣告過的環境變數交給終端機，所以 `HEALTH_TRACKER_AGENT_ID` 必須列在 `SKILL.md` 的 `required_environment_variables`；Linux 主機上的 skill 也要在 `platforms` 列出 `linux`，否則 `skill_view` 會拒絕載入。

本機看畫面：開發模式下打開 `/chat?demo`，不用登入、不會送出任何資料（正式版本會移除）。

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

請求五分鐘後失效。未帶 `x-health-identity` 的既有請求仍使用 `HERMES_API_SECRET` 和 `HEALTH_TRACKER_OWNER_ID`；`secondary` 身份只接受第二組密鑰並寫入第二組 UID。其他身份、缺少設定或重複密鑰／UID 都被拒絕；請求不可指定任意使用者。
