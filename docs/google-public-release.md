# 開放所有 Google 帳號使用

程式不限制登入者名單。要解除 Google 顯示的「只有測試人員可以存取」，必須由專案管理者在 Google Cloud 將 OAuth 應用程式設為 **External／外部** 並發布為 **In production／正式版**。推送 GitHub 或部署網站不會自動修改這項設定。

## 1. 先部署公開版

使用 GitHub 最新 `main` 重新建置、部署，並確認以下兩頁不需登入即可閱讀：

- 應用介紹：`https://business-card-keeper.ai.studio/about.html`
- 隱私權政策：`https://business-card-keeper.ai.studio/privacy.html`

目前 OAuth 網頁用戶端 ID：

```text
959741792176-makrjgf2p65l0a9p6kdsn7k0386v9vl2.apps.googleusercontent.com
```

若部署環境設定了 `VITE_GOOGLE_CLIENT_ID`，請確認也是這組 ID；它是在建置時讀取。這次更新會讓舊權限政策或其他 OAuth 用戶端的本機登入工作階段失效，使用者重新登入即可，本機名片不會刪除。

## 2. 設定相同專案的 API 與用戶端

在新用戶端所屬的 Google Cloud 專案中：

- 啟用 Google Sheets API 與 Google Drive API。
- [Google Auth Platform → 用戶端](https://console.cloud.google.com/auth/clients)：使用「網頁應用程式」，在「已授權的 JavaScript 來源」保留 `https://business-card-keeper.ai.studio`，不含結尾斜線或路徑。
- 本程式採瀏覽器彈出式授權，不需要另外建立 OAuth 回呼網址。

## 3. 對齊最小資料權限

在 [資料存取權](https://console.cloud.google.com/auth/scopes) 保留程式實際使用的三個範圍：

| OAuth 範圍 | 用途 |
| --- | --- |
| `https://www.googleapis.com/auth/drive.file` | 建立、讀寫及刪除本 App 建立或取得授權的名片試算表與照片 |
| `https://www.googleapis.com/auth/userinfo.email` | 區分同步帳號，避免跨帳號上傳 |
| `https://www.googleapis.com/auth/userinfo.profile` | 顯示登入者姓名與頭像 |

本版不再要求 `https://www.googleapis.com/auth/spreadsheets` 或完整 `drive` 權限；若主控台仍列出這些舊範圍，請移除不再使用的項目。Google 將 `drive.file` 列為推薦的非敏感權限；它也支援本程式使用的 Sheets 建立、讀取、更新與刪列操作。

新登入設定 `include_granted_scopes: false`，不主動合併歷史上較大的授權範圍。這不會撤銷使用者已在 Google 帳號中授予的舊權限；如需撤銷，可到 [Google 第三方連線](https://myaccount.google.com/connections) 操作，再回來登入。

## 4. 填寫公開資訊並正式發布

在 [品牌宣傳](https://console.cloud.google.com/auth/branding) 填寫正確的應用資訊：

| 欄位 | 內容 |
| --- | --- |
| 應用程式名稱 | 名片管家 |
| 使用者支援電子郵件 | 管理者實際會收信的信箱 |
| 開發人員聯絡資料 | 管理者實際會收信的信箱 |
| 應用程式首頁 | `https://business-card-keeper.ai.studio/about.html` |
| 隱私權政策 | `https://business-card-keeper.ai.studio/privacy.html` |

在 [目標對象](https://console.cloud.google.com/auth/audience) 選擇 **External／外部**，按 **Publish app／發布應用程式**，確認發布狀態變成 **In production／正式版**。此後不應再以測試使用者名單限制一般帳號登入。

「正式發布」與「Google 驗證完成」是不同狀態。Google 官方說明：只要求非敏感權限時，不強制進行敏感權限驗證；若要顯示經確認的自訂應用名稱或標誌，仍可能需要品牌驗證。依 [驗證中心](https://console.cloud.google.com/auth/verification) 實際顯示的要求處理，不要把發布按鈕當成已通過驗證。

品牌驗證可能要求證明相關網域的所有權。在 `ai.studio` 建立網站不代表擁有整個 `ai.studio` 網域；若平台無法協助完成所需的驗證，請使用自己持有、能驗證的網域，並同步更新 JavaScript 來源、首頁及隱私政策網址。

## 5. 使用非測試名單的帳號驗收

設定生效後，用另一個沒有加入測試名單的個人 Google 帳號，在新的瀏覽器工作階段中登入，檢查：

1. 不再出現「目前處於測試階段」的 `403 access_denied`。
2. 授權內容是個人資料及本 App 的檔案存取，沒有要求所有試算表或完整 Drive。
3. 新增一張合成測試名片，等候「已與 Google 同步」，確認它出現在該帳號的 Sheets；更新及刪除也能同步。
4. 使用者填入自己的 Gemini API key 後可辨識照片；Google 登入與 Gemini 額度是不同設定。

工作或學校的 Workspace 帳號仍可能受組織管理員政策限制；公開發布不會覆寫這些政策。

## 既有資料與驗證限制

`drive.file` 只列出本 OAuth 應用程式有權存取的檔案。由其他 OAuth 專案建立、手動複製或未授權給此 App 的舊檔案，可能不會被找到。新舊用戶端屬於不同 Google 專案時，請先建立完整名片備份；不要因看見新建的試算表就刪除舊資料。本機仍保留的名片會依既有同步邏輯處理，不能保證遠端獨有的照片可跨專案自動取得。

自動測試使用模擬 Google API，能驗證程式要求的範圍、資料隔離、同步及登入工作階段，無法代替 Google Cloud 的發布狀態、品牌審核或真實帳號授權驗收。

## 官方參考

- [發布狀態、測試使用者與未驗證使用者上限](https://support.google.com/cloud/answer/15549945?hl=en)：測試名單上限與要求未核准敏感／受限權限時的未驗證使用者上限不同。
- [驗證中心與非敏感權限](https://support.google.com/cloud/answer/13463073?hl=en)
- [Sheets API 權限範圍](https://developers.google.com/workspace/sheets/api/scopes)
- [Sheets 建立試算表支援的範圍](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/create)
- [品牌驗證與網域要求](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
