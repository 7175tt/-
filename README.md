# 名片管家

用手機拍攝或選取紙本名片照片，一次辨識聯絡資訊與原文。照片及資料先保存在瀏覽器的 IndexedDB；登入 Google 後，自動同步到自己的 Sheets 與私人 Drive 資料夾。

## 使用流程

1. 首次使用時，開啟「工具 → AI 辨識設定」，輸入自己的 Gemini API key 並儲存。接著點「掃描」，連續拍攝，或從相簿選擇多張照片。相機權限無法使用時，也能改用手機相機、照片或手動新增。
2. AI 在背景處理，每次最多兩張；結果標記為「待確認」。核對電話、Email 後儲存。辨識失敗保留照片，可重試或手動填寫。
3. 搜尋姓名、公司、電話、備註、辨識原文；支援全半形與電話格式差異。點電話、Email 或地址直接使用，或匯出 vCard 到手機通訊錄。
4. 在「工具」中點「登入並自動同步」。尚未綁定帳號的本機名片會綁定目前帳號；既有帳號的資料不會跨帳號自動上傳。也可在工具中「立即同步」。
5. 工具選單也提供手動新增、切換檢視、匯入匯出及備份。定期建立完整 JSON 備份；還原採合併，不覆蓋現有相同編號的名片。Excel 支援文字與原文的匯入匯出。

手機頂部保留搜尋、掃描、名片數量及儲存狀態，其他操作收在「工具」，讓名片有更多閱覽空間。儲存及同步失敗仍會明確提示。

相機支援時，優先擷取高解析度照片，保留完整畫面，避免不同相機的照片與預覽視角差異裁掉名片。照片最長邊保留至 3200px，以高品質 JPEG 儲存並限制每張最多 3 MB，不放大低解析度影像。不支援照片擷取的瀏覽器會使用預覽畫面並提示可改用「手機相機」；取景改為顯示完整預覽，避免直式畫面放大裁切後只剩少量像素。請等文字對焦清楚再拍攝，舊的模糊照片需要重拍或在編輯中更換。

網路中斷時，本機功能仍可使用；重新連線後同步已保存的變更。AI 需要連線，失敗的掃描可手動重試。請以頁面儲存狀態判斷是否保存成功，瀏覽器資料仍應定期備份。

同一瀏覽器一次只允許一個分頁操作名片，避免不同分頁互相覆蓋資料。其他分頁會顯示等待提示，原分頁關閉後自動載入最新資料。請使用支援 Web Locks 的新版瀏覽器及 HTTPS 網站（本機開發可用 localhost）。

## 個人 AI 金鑰

在 [Google AI Studio](https://aistudio.google.com/apikey) 建立自己的 Gemini API key，貼入「工具 → AI 辨識設定」。可先「測試連線」再儲存；測試會對目前辨識模型發出一個小型請求，可能使用少量額度。僅儲存設定不代表金鑰已通過驗證。沒有金鑰仍可保存照片、手動整理名片及使用 Google 同步。

預設金鑰放在目前分頁的 sessionStorage，重新整理仍保留；勾選「在此裝置記住金鑰」才放入 localStorage。瀏覽器可能恢復先前分頁，因此需要確實移除時請使用「移除金鑰」。記住的金鑰可被使用同一瀏覽器的人使用。金鑰不進入名片、完整備份、Sheets 或 Drive，Google 登入／登出也不會切換這把金鑰。

辨識時，金鑰和名片內容經 HTTPS 傳到本站後端，再由後端呼叫 Gemini；應用程式後端不儲存或記錄金鑰。每次請求使用自己的金鑰，額度及費用依該金鑰所屬的 Google 專案計算。無效金鑰不會改用站方金鑰。更換或清除金鑰會停止尚未完成的辨識，保留照片供手動重試。

網站預設不提供共用金鑰。只有管理員明確設定 `ALLOW_SHARED_GEMINI_KEY=true` 並提供 `GEMINI_API_KEY` 時，未填個人金鑰的使用者才會共用站方額度；設定畫面會標示此狀態。既有部署更新後也採此預設，請在介面輸入個人金鑰，或由管理員明確啟用共用模式。

## 本機開發

建議 Node.js 24 LTS，使用既有 checkout：

```sh
npm ci
cp .env.example .env
# 在網頁「AI 辨識設定」輸入個人金鑰；.env 僅供網站部署設定，不要提交。
npm run dev
```

- `ALLOW_SHARED_GEMINI_KEY`：預設 `false`，個人金鑰模式不需設定伺服器金鑰。只有明確設為 `true` 才允許訪客共用站方額度。
- `GEMINI_API_KEY`：選用的站方共用金鑰，須配合上述開關。真實辨識需要個人或共用金鑰有有效額度及模型權限。
- `GEMINI_MODEL`：預設 `gemini-2.5-flash`，可替換為帳號可用且支援圖片及結構化輸出的模型。
- `PORT`：預設 3000。
- `VITE_GOOGLE_CLIENT_ID`：公開的 Google OAuth 網頁用戶端 ID；未提供時沿用專案既有 ID。建置前設定，不要把 Gemini 金鑰放進任何 `VITE_` 變數。

Google 同步需啟用 Sheets／Drive API，設定 OAuth 同意畫面，並將實際網站來源加入「已授權的 JavaScript 來源」。手機瀏覽器的即時相機需要 HTTPS；本機 localhost 可用於桌面驗證。部署到網站後應使用 HTTPS。

目前預設 OAuth 用戶端為 `959741792176-makrjgf2p65l0a9p6kdsn7k0386v9vl2.apps.googleusercontent.com`，正式網站來源為 `https://business-card-keeper.ai.studio`。若出現 `400 origin_mismatch`，請在 [Google Cloud 用戶端設定](https://console.cloud.google.com/auth/clients) 編輯實際使用的網頁用戶端，將此來源加入「已授權的 JavaScript 來源」，保留其他仍使用中的來源。若部署環境已有 `VITE_GOOGLE_CLIENT_ID`，須同步更新為此 ID 或移除覆寫，並重新建置、部署；僅修改執行時環境變數不會更新已打包的前端。

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
BASE_URL=http://127.0.0.1:3100 python3 tests/browser-api-key-smoke.py
python3 tests/browser-camera-quality.py
```

前四個測試需先在相同埠啟動應用程式；相機畫質測試會自行啟動暫時的測試頁面。這些測試使用合成圖片、合成金鑰、模擬相機及辨識／Google API；單元測試也使用可控的 Gemini、Google 及 IndexedDB 替身，無需真實金鑰。它們驗證流程與錯誤處理，不能代替真實手機相機、模型品質或 OAuth 同步的驗收。

## 設計與相容性

- `/api/gemini/scan` 一次回傳聯絡欄位與 OCR 原文，保留舊的 extract／structure API。限制圖片大小與格式，支援逾時、取消及可重試錯誤。個人金鑰只透過 `x-gemini-api-key` 標頭傳送，每次請求建立獨立客戶端；`/check-key` 驗證指定金鑰，`/status` 只回報站方共用設定是否存在。
- IndexedDB 以完整快照原子保存卡片與待刪除紀錄，失敗時保留記憶體資料並提示備份／重試。舊 `business-cards-db` 成功移轉後仍保留原始備份；舊登入 token 不再持續存於 localStorage。
- 同步先保存帳號歸屬，再執行雲端寫入；同步回應不覆寫期間的新編輯。刪除紀錄只在成功後確認，並以同步版本及試算表 ID 判斷其他裝置的刪除。
- Google Sheet 保留原 A:J 欄，新增 K 欄保存原文，能讀取舊資料。修正首／中／末列更新及刪除索引；更換照片按內容建立版本，重試不重複上傳，寫入失敗保留舊照片，刪除名片成功後清理所有照片版本。
- 新上傳照片維持私人權限。舊版曾設為公開的照片不會自動改權限，既有分享狀態須由資料擁有人檢查。
- Sheets 沒有跨裝置交易鎖；同一時間在兩台裝置新增相同 ID 或修改同一張名片仍可能產生競態。已處理單一分頁的併發及重試，並保留未上傳的本機修改。多人即時協作若成為需求，應改用有版本條件寫入的資料庫。
