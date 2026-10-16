# 啟用手機／電腦的 Google 長期登入

Google access token 通常約一小時到期。此版本支援由後端使用 refresh token 自動取得新授權，重新開啟同一瀏覽器時也能恢復登入。先完成以下部署設定，再用 Google 登入一次。

## 後端部署設定

在 Google AI Studio 對應的 Cloud Run 服務「編輯及部署新修訂版本 → 變數與密鑰」設定：

| 變數 | 值 |
| --- | --- |
| `GOOGLE_OAUTH_CLIENT_SECRET` | 目前網頁 OAuth 用戶端的 Client Secret。從 [Google Cloud 憑證](https://console.cloud.google.com/apis/credentials?project=959741792176) 開啟目前的網頁用戶端取得。 |
| `GOOGLE_SESSION_SECRET` | 至少 32 個隨機字元。可以在自己的終端機執行 `openssl rand -base64 32` 產生，保存於後端環境變數或 Secret Manager。 |
| `GOOGLE_AUTH_ORIGIN` | `https://business-card-keeper.ai.studio`，不含路徑或結尾斜線。若更換網站網址，改為實際公開來源。 |

預設 OAuth client ID 為 `959741792176-makrjgf2p65l0a9p6kdsn7k0386v9vl2.apps.googleusercontent.com`。若換用另一個用戶端，同時設定後端 `GOOGLE_OAUTH_CLIENT_ID` 與建置時的 `VITE_GOOGLE_CLIENT_ID`，密鑰也必須屬於該用戶端。

OAuth 用戶端必須已授權網站的 JavaScript 來源；Popup code flow 交換授權碼時使用這個網站來源。不要把後端密鑰放入 `VITE_` 變數、前端程式碼或 GitHub。所有 Cloud Run 副本與後續修訂版本都要使用相同的 `GOOGLE_SESSION_SECRET`；更換這把密鑰會使既有裝置需要重新登入。

重新部署完整應用程式後，在網頁按 Google 登入並授權。`GET /api/google/status` 應回覆 `persistentConfigured: true`；此回應只代表部署設定完整，仍須在真實 Google 帳號完成一次登入驗證。沒有這些設定時，工具沿用分頁登入，記住上次帳號並在需要時提示使用者點一下重新連線。

## 使用行為與限制

- 原始 refresh token 只在後端處理，裝置保存的是 AES-GCM 加密、`Secure`、`HttpOnly`、`SameSite=Lax` 的 host-only Cookie；網頁 JavaScript 不能讀取。Cookie 以 90 天滾動期限保存，使用中會更新期限。
- 前端於 access token 快到期時自動更新；遇到意外的 API 401 時，共用一次更新並重試原操作。相同帳號更新授權時維持畫面與名片歸屬。
- 回到頁面、網路恢復後會再次檢查。授權被撤銷或更新憑證失效時停止自動重試，顯示重新連線按鈕；本機名片與照片仍保留。
- 主動登出會清除裝置 Cookie、分頁 token 與上次帳號記憶。瀏覽器清除 Cookie、無痕視窗、Google 要求重新驗證或網站更換來源，都可能需要重新登入。
- Google OAuth 應用程式若仍處於「測試」發布狀態，包含 Drive／Sheets 範圍的 refresh token 通常只維持七天。提供長期使用前，請完成正式發布與 Google 要求的驗證。Google 的授權仍可由使用者或管理員撤銷，無法保證永久不需重新驗證。

參考：[Google Code Model](https://developers.google.com/identity/oauth2/web/guides/use-code-model)、[Refresh token 到期條件](https://developers.google.com/identity/protocols/oauth2#expiration)。
