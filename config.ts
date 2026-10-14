// =================================================================================
// !! 重要設定 !!
// =================================================================================
// 若要啟用 Google 雲端同步功能，您必須從 Google Cloud Console 建立一個
// OAuth 2.0 用戶端 ID，並將其貼在此處。
//
// 步驟：
// 1. 前往 https://console.cloud.google.com/apis/credentials
// 2. 建立一個新的「OAuth 2.0 用戶端 ID」。
// 3. 應用程式類型請選擇「網頁應用程式」。
// 4. 在「已授權的 JavaScript 來源」下方，新增您部署此應用程式的網址。
//    （應用程式啟動時會在瀏覽器主控台顯示正確的來源網址）。
// 5. 複製「用戶端 ID」並貼在下方，取代預設的預留位置字串。
// =================================================================================
export const GOOGLE_CLIENT_ID: string = "570663652971-og086jj64jja54dr8vqvvqqrpkcf0if7.apps.googleusercontent.com";

// Google Sheets 和 Drive 中使用的檔案/資料夾名稱。
export const SPREADSHEET_NAME = "名片管家資料庫 (Business Card Keeper)";
export const CARD_SHEET_NAME = "名片資料";
// 所有名片照片都會被儲存在這個名稱的 Google Drive 資料夾中，以保持您的雲端硬碟整潔。
export const IMAGE_FOLDER_NAME = "名片管家照片 (Business Card Images)";