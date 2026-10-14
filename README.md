# 名片管家

用手機拍攝或選取紙本名片照片，一次辨識聯絡資訊與原文。照片及資料先保存在瀏覽器的 IndexedDB；登入 Google 後，自動同步到自己的 Sheets 與私人 Drive 資料夾。

## 使用流程

1. 點「掃描名片」，連續拍攝，或從相簿選擇多張照片。相機權限無法使用時，也能改用手機相機、照片或手動新增。
2. AI 在背景處理，每次最多兩張；結果標記為「待確認」。核對電話、Email 後儲存。辨識失敗保留照片，可重試或手動填寫。
3. 搜尋姓名、公司、電話、備註、辨識原文；支援全半形與電話格式差異。點電話、Email 或地址直接使用，或匯出 vCard 到手機通訊錄。
4. 點「登入並自動同步」。尚未綁定帳號的本機名片會綁定目前帳號；既有帳號的資料不會跨帳號自動上傳。也可隨時「立即同步」。
5. 定期建立完整 JSON 備份；還原採合併，不覆蓋現有相同編號的名片。Excel 支援文字與原文的匯入匯出。

照片會壓縮為最多 2000px 的 JPEG，減少手機上傳時間。網路中斷時，本機功能仍可使用；重新連線後同步已保存的變更。AI 需要連線，失敗的掃描可手動重試。請以頁面儲存狀態判斷是否保存成功，瀏覽器資料仍應定期備份。

同一瀏覽器一次只允許一個分頁操作名片，避免不同分頁互相覆蓋資料。其他分頁會顯示等待提示，原分頁關閉後自動載入最新資料。請使用支援 Web Locks 的新版瀏覽器及 HTTPS 網站（本機開發可用 localhost）。

## 本機開發

建議 Node.js 24 LTS，使用既有 checkout：

```sh
npm ci
cp .env.example .env
# 在 .env 設定 GEMINI_API_KEY，不要提交此檔案。
npm run dev
```

- `GEMINI_API_KEY`：伺服器端 Gemini 金鑰；沒有金鑰仍可開啟頁面、整理及手動輸入名片。真實辨識必須有有效金鑰與模型權限。
- `GEMINI_MODEL`：預設 `gemini-2.5-flash`，可替換為帳號可用且支援圖片及結構化輸出的模型。
- `PORT`：預設 3000。
- `VITE_GOOGLE_CLIENT_ID`：公開的 Google OAuth 網頁用戶端 ID；未提供時沿用專案既有 ID。建置前設定，不要把 Gemini 金鑰放進任何 `VITE_` 變數。

Google 同步需啟用 Sheets／Drive API，設定 OAuth 同意畫面，並將實際網站來源加入「已授權的 JavaScript 來源」。手機瀏覽器的即時相機需要 HTTPS；本機 localhost 可用於桌面驗證。部署到網站後應使用 HTTPS。

在受管理的 Codex 雲端環境，沿用平台 HTTPS 代理與 CA 設定；Node 24 可使用 `NODE_USE_ENV_PROXY=1 npm run dev`。不要停用 TLS 驗證。

## 驗證與正式啟動

```sh
npm run typecheck
npm test
npm run build
npm start
```

`npm start` 明確使用正式模式，提供建置後的前端及同一個 Express API。Tailwind CSS 隨建置打包，首頁不依賴外部樣式 CDN。XLSX 只在使用 Excel 功能時下載。

瀏覽器測試使用 Python Playwright 與系統 Chromium：

```sh
BASE_URL=http://127.0.0.1:3100 python3 tests/browser-scan-smoke.py
BASE_URL=http://127.0.0.1:3100 python3 tests/browser-sync-smoke.py
BASE_URL=http://127.0.0.1:3100 python3 tests/browser-storage-smoke.py
```

請先在相同埠啟動應用程式。這些測試使用合成圖片與模擬的辨識及 Google API；單元測試也使用可控的 Gemini、Google 及 IndexedDB 替身，無需真實金鑰。它們驗證流程與錯誤處理，不能代替真實手機相機、模型品質或 OAuth 同步的驗收。

## 設計與相容性

- `/api/gemini/scan` 一次回傳聯絡欄位與 OCR 原文，保留舊的 extract／structure API。限制圖片大小與格式，支援逾時、取消及可重試錯誤。金鑰只由伺服器讀取。
- IndexedDB 以完整快照原子保存卡片與待刪除紀錄，失敗時保留記憶體資料並提示備份／重試。舊 `business-cards-db` 成功移轉後仍保留原始備份；舊登入 token 不再持續存於 localStorage。
- 同步先保存帳號歸屬，再執行雲端寫入；同步回應不覆寫期間的新編輯。刪除紀錄只在成功後確認，並以同步版本及試算表 ID 判斷其他裝置的刪除。
- Google Sheet 保留原 A:J 欄，新增 K 欄保存原文，能讀取舊資料。修正首／中／末列更新及刪除索引；更換照片按內容建立版本，重試不重複上傳，寫入失敗保留舊照片，刪除名片成功後清理所有照片版本。
- 新上傳照片維持私人權限。舊版曾設為公開的照片不會自動改權限，既有分享狀態須由資料擁有人檢查。
- Sheets 沒有跨裝置交易鎖；同一時間在兩台裝置新增相同 ID 或修改同一張名片仍可能產生競態。已處理單一分頁的併發及重試，並保留未上傳的本機修改。多人即時協作若成為需求，應改用有版本條件寫入的資料庫。
