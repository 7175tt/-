// Google OAuth「網頁應用程式」的公開用戶端 ID，不是 Gemini API key。
// 在 https://console.cloud.google.com/auth/clients 編輯相同 ID 的用戶端，
// 將 https://business-card-keeper.ai.studio 加入「已授權的 JavaScript 來源」。
// 其他網站來源需各自登記；來源不含路徑、查詢參數或結尾斜線。
// 部署時可用 VITE_GOOGLE_CLIENT_ID 覆寫；Vite 在建置時讀取，變更後需重新建置部署。
export const GOOGLE_CLIENT_ID: string = import.meta.env?.VITE_GOOGLE_CLIENT_ID || "959741792176-makrjgf2p65l0a9p6kdsn7k0386v9vl2.apps.googleusercontent.com";

// Google Sheets 和 Drive 中使用的檔案/資料夾名稱。
export const SPREADSHEET_NAME = "名片管家資料庫 (Business Card Keeper)";
export const CARD_SHEET_NAME = "名片資料";
// 所有名片照片都會被儲存在這個名稱的 Google Drive 資料夾中，以保持您的雲端硬碟整潔。
export const IMAGE_FOLDER_NAME = "名片管家照片 (Business Card Images)";
