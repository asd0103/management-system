# 詩宜管理系統交接包

這個資料夾是給接手工程師使用的管理系統交接包。

## 資料夾內容

- `frontend/`
  - 管理系統前端正式部署檔
  - 直接部署用，不需要重新 build 前端
- `backend/`
  - 管理系統後端部署必要檔案
- `docs/`
  - 部署與 GitHub 交接文件

## 給接手者的順序

1. 先看 `docs/management-system-self-deploy-guide-20260419.md`
2. 再看 `docs/management-system-github-handoff-plan-20260419.md`
3. 照文件把 `frontend/` 和 `backend/` 部署到伺服器

## 注意

- 這份交接包只給管理系統
- 不包含投放監測儀表板
