# 部署：GitHub、Vercel、Firebase

## 1. Firebase

1. 在 Firebase Console 建立一個新的專案。
2. 新增「Web app」，取得 Firebase Web App 設定。
3. 啟用 **Authentication → Google** 登入。
4. 建立 **Cloud Firestore（Native mode）**。位置建議選日後最常使用的亞洲區域；位置建立後不能更改。
5. 將專案根目錄的 `firestore.rules` 發布到 Firebase。
6. 建立 Firebase Admin service account 金鑰，將整份 JSON 轉為單行內容，僅放入 Vercel 的環境變數。

首次登入網站後，Firebase Authentication 的使用者 ID 就是 `HEALTH_TRACKER_OWNER_ID`。

## 2. GitHub

1. 建立 **Private** repository。
2. 將此專案推送到 `main` 分支。
3. `.env*` 已被忽略，絕對不要提交 Firebase service account 或 Hermes secret。

## 3. Vercel

1. 在 Vercel Import Git Repository，選擇該 GitHub repository。
2. Framework 選 **Next.js**，Build Command 使用 `npm run build`。
3. 在 Project → Settings → Environment Variables 設定以下值：

```text
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON
HEALTH_TRACKER_OWNER_ID
HERMES_API_SECRET
```

4. 部署後，把 Vercel 網域加入 Firebase Authentication 的 Authorized domains。
5. 以 Google 登入一次，從瀏覽器主控台或 Firebase Authentication 使用者頁複製 UID，填入 `HEALTH_TRACKER_OWNER_ID`，重新部署。
6. 產生 32 位元以上的隨機 `HERMES_API_SECRET`，用相同值設定 Hermes 主機環境變數。

## 驗收順序

1. 網站登入後手動新增一筆食物，重新整理頁面確認仍存在。
2. 新增 250 ml 飲水與體重，確認跨裝置可見。
3. Hermes 先呼叫 `get_daily_summary`。
4. Hermes 寫入一筆測試飲食，確認網站立即可見。
5. 用錯誤密鑰測試，API 必須回傳 `401 unauthorized`。
