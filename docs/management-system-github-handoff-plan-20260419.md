# 詩宜管理系統 GitHub 交接規劃

這份文件是給「要把管理系統交給下一位工程師」時使用的規劃文件。

目標只有一個：

- 讓接手者可以從 Git 取得原始碼
- 自己 build
- 自己部署
- 不會把投放監測儀表板混進管理系統

## 1. 建議做法

業界最穩的方式是：

1. 把管理系統整理成單獨 Git 倉庫
2. 把部署文件一起放進 repo
3. `.env`、正式帳密、資料庫密碼不要提交到 Git
4. 另外交接伺服器權限、cPanel 權限、資料庫權限

## 2. 建議的新倉庫名稱

建議倉庫名稱：

- `shihyi-management-system`

## 3. 建議倉庫結構

最理想的管理系統交接 repo 結構如下：

```text
shihyi-management-system/
  frontend/
  backend/
  docs/
  .gitignore
  README.md
```

對應目前資料來源：

- `frontend/` <- `C:\Users\user\Documents\New project\frontend-management`
- `backend/` <- `C:\Users\user\Documents\New project\backend`
- `docs/` <- `C:\Users\user\Documents\New project\docs`

## 4. 目前資料夾怎麼搬

如果你現在要整理成新的 Git 倉庫，建議只搬這些：

### 前端

來源：

- `C:\Users\user\Documents\New project\frontend-management`

搬到新 repo 後：

- `frontend`

### 後端

來源：

- `C:\Users\user\Documents\New project\backend`

搬到新 repo 後：

- `backend`

### 文件

至少保留：

- `management-system-self-deploy-guide-20260419.md`
- `management-system-github-handoff-plan-20260419.md`
- `project-separation-map.md`

## 5. 不要提交到 Git 的內容

以下內容不要進 Git：

- `node_modules`
- `dist`
- `.env`
- `data/*.db`
- `uploads/*`
- 暫存圖片、log、快照截圖
- 舊備份 zip

## 6. 建議 `.gitignore`

```gitignore
node_modules/
dist/
.env
.DS_Store
data/*.db
data/*.db-journal
uploads/*
*.log
```

## 7. README 應該寫什麼

接手者打開 repo 後，第一眼應該看到：

1. 這是管理系統，不是投放監測
2. 怎麼安裝依賴
3. 怎麼 build
4. 怎麼部署前端
5. 怎麼部署後端
6. 正式網址和伺服器位置

## 8. GitHub 交接流程

建議流程：

1. 建立新倉庫 `shihyi-management-system`
2. 把管理系統前端、後端、docs 放進去
3. 補上 `.gitignore`
4. 補上 repo 根目錄 `README.md`
5. 首次 commit
6. push 到 GitHub
7. 將接手者加入 repo 權限
8. 另外安全地交 `.env`、cPanel、資料庫帳密
9. 約一次線上交接，讓對方實際部署一遍

## 9. 建議交接給接手者的內容

Git 倉庫以外，另外還要交：

- cPanel 帳號
- Node.js App 操作方式
- MySQL / 資料庫權限
- 網域 / 子網域資訊
- 若有第三方 API 金鑰，也要另外交

## 10. 現況提醒

目前前端已經拆成：

- `frontend-management`
- `frontend-marketing`

這是正確方向。

但後端目前仍是共用資料夾：

- `backend`

所以如果未來要做到最乾淨，建議再拆成：

- `backend-management`
- `backend-marketing`

目前如果只是先完成管理系統交接，可以先用現有 `backend`，但文件裡一定要明講：這個後端資料夾是當前交接版本，不要再把 marketing 功能混進管理系統前端部署。

## 11. 最實際的交付組合

如果今天就要交給別人，最實際的組合是：

1. GitHub repo：管理系統原始碼
2. 部署文件：`management-system-self-deploy-guide-20260419.md`
3. 規劃文件：`management-system-github-handoff-plan-20260419.md`
4. 備份：`source-snapshot-clean-20260419-150654.zip`
5. 另外私下交接：`.env`、cPanel、資料庫帳密
