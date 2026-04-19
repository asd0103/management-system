# 詩宜管理系統自助部署指南

這份文件只針對「管理系統」使用，不包含投放監測儀表板。

## 1. 需要交付的內容

交給接手者時，至少提供這三項：

1. 前端正式版
   - `C:\Users\user\Documents\New project\frontend-management\dist`
2. 後端原始碼
   - `C:\Users\user\Documents\New project\backend`
3. 這份部署文件
   - `C:\Users\user\Documents\New project\docs\management-system-self-deploy-guide-20260419.md`

如果要保留一份可還原快照，也可以一併提供：

- `C:\Users\user\Documents\New project\backups\source-snapshot-clean-20260419-150654.zip`

## 2. 正式網址

- 前端：<https://asd.shiyipr.com/>
- 後端 health：<https://api.shiyipr.com/api/health>

## 3. 伺服器路徑

前端：

- `/home2/marketpl/asd.shiyipr.com/index.html`
- `/home2/marketpl/asd.shiyipr.com/assets`

後端：

- `/home2/marketpl/api.shiyipr.com/backend`
- `/home2/marketpl/api.shiyipr.com/backend/src`

## 4. 前端部署方式

本機正式版來源：

- `C:\Users\user\Documents\New project\frontend-management\dist\index.html`
- `C:\Users\user\Documents\New project\frontend-management\dist\assets`

上傳目標：

- `/home2/marketpl/asd.shiyipr.com/index.html`
- `/home2/marketpl/asd.shiyipr.com/assets`

注意：

- `index.html` 和 `assets` 必須一起更新
- 不要只更新 `assets`
- 不要只更新 `index.html`
- 上傳後請在瀏覽器按 `Ctrl + F5`

## 5. 後端部署方式

本機來源：

- `C:\Users\user\Documents\New project\backend\src\app.js`
- `C:\Users\user\Documents\New project\backend\src\db.js`
- `C:\Users\user\Documents\New project\backend\src\upload.js`
- `C:\Users\user\Documents\New project\backend\app.cjs`
- `C:\Users\user\Documents\New project\backend\package.json`
- `C:\Users\user\Documents\New project\backend\package-lock.json`

上傳目標：

- `/home2/marketpl/api.shiyipr.com/backend/src/app.js`
- `/home2/marketpl/api.shiyipr.com/backend/src/db.js`
- `/home2/marketpl/api.shiyipr.com/backend/src/upload.js`
- `/home2/marketpl/api.shiyipr.com/backend/app.cjs`
- `/home2/marketpl/api.shiyipr.com/backend/package.json`
- `/home2/marketpl/api.shiyipr.com/backend/package-lock.json`

上傳後：

1. 進入 cPanel 的 `Setup Node.js App`
2. 找到 `api.shiyipr.com/backend`
3. 按 `Restart`
4. 如果依賴有變動，再執行 `Run NPM Install`

## 6. 建議驗收項目

前端：

- 首頁可正常載入
- 請款系統可開啟、可送審、可切換狀態
- 財務金流可進入，已完成撥款會在完成區塊
- 工單、請假、工讀生系統可正常進入
- 左側 badge 只有在有待辦時才顯示

後端：

- `https://api.shiyipr.com/api/health` 可回應成功
- 使用者登入正常
- `/api/claims`、`/api/payouts`、`/api/quotes`、`/api/customers` 可正常工作

## 7. 交接注意事項

- 這份管理系統前端只對應 `frontend-management`
- 不要把 `frontend-marketing` 混進來
- 若接手者要重新整理成新 Git 倉庫，請先看：
  - `management-system-github-handoff-plan-20260419.md`
