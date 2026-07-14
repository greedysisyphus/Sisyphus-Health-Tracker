# 日常營養

以繁體中文打造的個人減重與飲食紀錄 Web App。首頁可快速記錄飲食、查看熱量與三大營養素進度，並提供身體趨勢、食物庫、設定與資料匯出介面。

## 功能
- 今日熱量、蛋白質、碳水、脂肪、糖與飲水摘要
- 快速新增飲食、餐次整理、食物庫與體重趨勢
- 使用者可調整減脂目標，支援台灣常見飲食情境
- Firebase 環境變數與 Firestore 使用者隔離規則範例

## 啟動與部署

1. 複製 `.env.example` 為 `.env.local`，填入 Firebase Web App 設定。
2. 安裝套件後執行 `npm run dev`。
3. 執行 `npm run build` 驗證可部署版本。

Firebase 專案需手動啟用 Google 與 Email/Password 登入，並將 `firestore.rules` 發布至 Firestore。正式資料結構以 `users/{userId}` 為根，子集合包含 `foods`、`recipes`、`dailyLogs/{YYYY-MM-DD}/entries`、`bodyLogs` 與 `settings/profile`。

## 專案結構

`app/` 頁面與樣式；`lib/` Firebase 與計算工具；`types/` Firestore 模型；`tests/` 測試；`firestore.rules` 存取規則。
