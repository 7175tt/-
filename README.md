# 名片管家

用手機拍攝或選取紙本名片照片，一次辨識聯絡資訊與原文。照片及資料先保存在瀏覽器的 IndexedDB；登入 Google 後，自動同步到自己的 Sheets 與私人 Drive 資料夾。

## 使用流程

1. 首次使用時，開啟「工具 → AI 辨識設定」，輸入自己的 Gemini API key 並儲存。接著點「掃描」，連續拍攝，或從相簿選擇多張照片。相機權限無法使用時，也能改用手機相機、照片或手動新增。
2. AI 在背景處理，每次最多兩張；結果標記為「待確認」。核對電話、Email 後儲存。辨識失敗保留照片，可重試或手動填寫。
3. 搜尋姓名、公司、電話、備註、辨識原文；支援全半形與電話格式差異。點電話、Email 或地址直接使用，或匯出 vCard 到手機通訊錄。
4. 在「工具」中點「登入並自動同步」。尚未綁定帳號的本機名片會綁定目前帳號；既有帳號的資料不會跨帳號自動上傳。也可在工具中「立即同步」。
5. 工具選單也提供手動新增、切換檢視、匯入匯出及備份。定期建立完整 JSON 備份；還原採合併，不覆蓋現有相同編號的名片。Excel 支援文字與原文的匯入匯出。

畫面使用完整可用寬度，卡片欄數隨螢幕增加；桌面搜尋與主要按鈕排在同一列。名片先顯示姓名、公司、職稱、電話與 Email，點「詳細」可展開完整文字、地址與備註。卡片不會跟著同列最長的內容被拉高。手動新增與兩種檢視合併在工具選單的一列，檢視選擇會記住於此瀏覽器。

大量名片採每頁 24 張，搜尋與匯出仍涵蓋全部資料。列表使用最長邊 256px 的縮圖，只有進入畫面的照片才準備，同時最多處理兩張；翻頁會釋放前頁的縮圖與載入工作。原始照片與小縮圖獨立存於 IndexedDB；首次只為畫面內的照片建立縮圖，之後閱覽直接讀取小縮圖，放大／編輯時才再讀原圖。舊版資料會原子升級；照片寫入成功後才釋放記憶體中的原圖。一般文字修改不會重新寫入整批照片。

Google 授權約一小時到期。部署端可啟用裝置長期登入，讓後端自動續接並在重新開啟頁面時恢復；完整設定與限制見 [Google 裝置長期登入](docs/google-device-login.md)。未啟用後端設定時，工具記住帳號並提示按一下重新連線。主動登出會清除裝置記憶；授權失效時保留本機資料並停止反覆自動同步。

卡片與列表檢視的雲端照片會在進入可見範圍時自動載入，同時最多下載四張，相同照片共用進行中的下載；進入編輯頁也會自動載入。下載成功後保存於本機並可放大查看，未登入、授權到期、檔案無法讀取時會提示原因並提供重試。舊版儲存的完整圖片 data URL 也可直接顯示。

早期版本上傳的照片曾設定為「知道連結的人可讀」。更換 Google OAuth 專案後，`drive.file` 授權可能讀不到這些舊檔，即使原檔仍存在。當 Drive API 回傳 403／404 時，工具會嘗試透過後端讀取原檔既有的分享下載連結，成功後快取於本機；不會更改照片或資料夾的分享權限。私密檔案不會因此變成公開，讀取失敗時可點「查看原檔」確認 Google Drive 中的檔案與帳號。

直接在 Google Sheet 改姓名或其他欄位，不需要手動修改 timestamp 欄。回到工具、按「立即同步」或下一次背景同步時，本機沒有待上傳修改的名片會採用目前試算表內容，同一張照片的本機快取會保留。正在編輯或尚未上傳的本機修改仍受保護。

相機支援時，優先擷取高解析度照片，保留完整畫面，避免不同相機的照片與預覽視角差異裁掉名片。照片最長邊保留至 3200px，以高品質 JPEG 儲存並限制每張最多 3 MB，不放大低解析度影像。不支援照片擷取的瀏覽器會使用預覽畫面並提示可改用「手機相機」；取景改為顯示完整預覽，避免直式畫面放大裁切後只剩少量像素。請等文字對焦清楚再拍攝，舊的模糊照片需要重拍或在編輯中更換。

網路中斷時，本機功能仍可使用；重新連線後同步已保存的變更。AI 需要連線，失敗的掃描可手動重試。請以頁面儲存狀態判斷是否保存成功，瀏覽器資料仍應定期備份。

同一瀏覽器一次只允許一個分頁操作名片，避免不同分頁互相覆蓋資料。其他分頁會顯示等待提示，原分頁關閉後自動載入最新資料。請使用支援 Web Locks 的新版瀏覽器及 HTTPS 網站（本機開發可用 localhost）。

## 本機開發

個人 API key 可從 [Google AI Studio](https://aistudio.google.com/apikey) 取得。預設只保留在目前分頁；勾選「在此裝置記住金鑰」後可於下次使用。金鑰與名片、JSON 備份、Sheets／Drive 同步分開儲存。辨識與連線測試透過 HTTPS 將金鑰交給網站後端，再呼叫 Gemini；後端不儲存金鑰，也不會在個人金鑰失敗時改用其他金鑰。測試可能使用少量 Gemini 額度。

建議 Node.js 24 LTS，使用既有 checkout：

```sh
npm ci
cp .env.example .env
# 在網頁「AI 辨識設定」輸入個人金鑰；.env 僅供部署設定，不要提交。
npm run dev
```

- `ALLOW_SHARED_GEMINI_KEY`：預設 `false`。若要讓訪客共用站方額度，管理員需明確設為 `true` 並設定 `GEMINI_API_KEY`；既有部署更新後也採此預設。
- `GEMINI_API_KEY`：選用的站方共用金鑰，需配合上述開關。沒有個人或共用金鑰仍能保存照片、手動整理與同步名片。
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
BASE_URL=http://127.0.0.1:3100 python3 tests/browser-photo-smoke.py
BASE_URL=http://127.0.0.1:3100 python3 tests/browser-api-key-smoke.py
BASE_URL=http://127.0.0.1:3100 python3 tests/browser-density-smoke.py
BASE_URL=http://127.0.0.1:3100 python3 tests/browser-performance-smoke.py
BASE_URL=http://127.0.0.1:3100 python3 tests/browser-google-session-smoke.py
python3 tests/browser-camera-quality.py
```

前八個測試需先在相同埠啟動應用程式；相機畫質測試會自行啟動暫時的測試頁面。這些測試使用合成圖片、合成金鑰、模擬相機及辨識／Google API；單元測試也使用可控的 Gemini、Google 及 IndexedDB 替身，無需真實金鑰。它們驗證流程與錯誤處理，不能代替真實手機相機、模型品質或 OAuth 同步的驗收。

## 設計與相容性

- `/api/gemini/scan` 一次回傳聯絡欄位與 OCR 原文，保留舊的 extract／structure API。限制圖片大小與格式，支援逾時、取消及可重試錯誤。個人金鑰只透過 `x-gemini-api-key` 標頭傳送，每次請求建立獨立客戶端；`/check-key` 驗證指定金鑰，`/status` 回報站方共用設定是否存在。
- `/api/drive/public-photo/:fileId` 僅下載原本已允許匿名讀取的舊照片。限制 Google 檔案 ID、下載及重新導向目的地、15 秒逾時與 12 MB 大小，驗證圖片格式，不轉送 cookies、OAuth token 或 API key，也不接受任意來源網址。這項相容功能需要一併部署後端。
- IndexedDB v2 以同一交易原子保存文字快照、獨立照片與待刪除紀錄，失敗時保留記憶體資料並提示備份／重試。舊 `business-cards-db` 成功移轉後仍保留原始備份；舊登入 token 不再持續存於 localStorage。
- 同步先保存帳號歸屬，再執行雲端寫入；同步回應不覆寫期間的新編輯。刪除紀錄只在成功後確認，並以同步版本及試算表 ID 判斷其他裝置的刪除。
- Google Sheet 保留原 A:J 欄，新增 K 欄保存原文，能讀取舊資料。修正首／中／末列更新及刪除索引；更換照片按內容建立版本，重試不重複上傳，寫入失敗保留舊照片，刪除名片成功後清理所有照片版本。
- 新上傳照片維持私人權限。舊版曾設為公開的照片不會自動改權限，既有分享狀態須由資料擁有人檢查。
- Sheets 沒有跨裝置交易鎖；同一時間在兩台裝置新增相同 ID 或修改同一張名片仍可能產生競態。已處理單一分頁的併發及重試，並保留未上傳的本機修改。多人即時協作若成為需求，應改用有版本條件寫入的資料庫。
