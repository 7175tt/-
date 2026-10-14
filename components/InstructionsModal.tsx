
import React from 'react';
import Icon from './Icon';

interface InstructionsModalProps {
  onClose: () => void;
}

const InstructionsModal: React.FC<InstructionsModalProps> = ({ onClose }) => {
  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 animate-fade-in"
      aria-labelledby="instructions-dialog-title"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-xl shadow-2xl p-6 m-4 max-w-lg w-full transform transition-all scale-100 animate-zoom-in text-gray-300 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between flex-shrink-0 pb-4 border-b border-gray-700">
          <h2 id="instructions-dialog-title" className="text-xl font-bold text-white">使用說明</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="關閉說明">
            <Icon name="x-mark" className="h-6 w-6" />
          </button>
        </header>

        <main className="mt-4 flex-grow overflow-y-auto pr-2 space-y-6">
          <p>歡迎使用「名片管家」！這是一個智慧名片簿，幫助您輕鬆數位化、管理您的人脈。</p>

          <InstructionSection icon="camera" title="掃描名片">
            <ul className="list-disc list-inside space-y-2 text-gray-400">
              <li>首次使用請到「工具 → AI 辨識設定」填入自己的 Gemini API key，可先測試再儲存。辨識使用該金鑰所屬專案的額度，與 Google 同步登入分開。</li>
              <li>金鑰預設只保留於目前分頁，也可選擇在此裝置記住；可隨時在設定中清除。金鑰不會加入名片備份或雲端同步。</li>
              <li>點擊主畫面的 <span className="font-semibold text-blue-400">「掃描」</span> 按鈕。</li>
              <li>將名片完整對準畫面中的 <span className="font-semibold text-yellow-400">提示框線</span>。</li>
              <li>等文字對焦清楚，再點圓形拍照鈕。支援時會拍攝高解析度照片並保留完整畫面，框線用來協助對準名片。</li>
              <li>每拍完一張，照片會先保留在本機，AI 在背景依序辨識，您不需等待。</li>
              <li>也可從相簿一次選多張，或使用「手機相機」拍攝；相機無法開啟時仍可手動新增。</li>
              <li>您可以無縫地繼續拍攝下一張名片。</li>
              <li>全部拍攝完成後，點擊左上角的 <span className="font-semibold text-blue-400">「完成」</span> 按鈕返回主畫面查看結果。</li>
            </ul>
          </InstructionSection>

           <InstructionSection icon="cloud-check" title="雲端同步 (推薦)">
            <ul className="list-disc list-inside space-y-2 text-gray-400">
              <li>打開主畫面的 <span className="font-semibold text-blue-400">「工具」</span>，點擊「登入並自動同步」。</li>
              <li>授權後，您的所有名片資料（含照片）將會安全地儲存在您自己的 Google Sheets 和 Google Drive 中。</li>
              <li><strong className="text-green-400">資料位置：</strong>文字資料儲存在一個名為「名片管家資料庫」的 Google Sheet 中；照片則在「名片管家照片」資料夾。</li>
              <li>登入後，您可以從「工具」選單中找到「在 Sheets 中開啟」的選項，直接在瀏覽器新分頁中開啟您的資料庫。</li>
              <li>登入後會自動下載雲端名片，並上傳尚未綁定帳號的本機資料。修改與刪除也會自動同步。</li>
              <li>離線或授權過期時，變更保留在本機；重新連線或登入後再同步。請查看頁面上方的儲存與同步狀態。</li>
              <li>切換帳號不會把原帳號的名片自動上傳到新帳號。請定期下載完整備份。</li>
            </ul>
          </InstructionSection>

          <InstructionSection icon="search" title="管理與搜尋">
             <ul className="list-disc list-inside space-y-2 text-gray-400">
              <li>直接在主畫面的搜尋框輸入姓名、公司、電話、備註或照片中辨識到的文字；多個關鍵字可以用空格分開。</li>
              <li>點搜尋框右邊的篩選按鈕，針對「姓名」、「公司」等欄位搜尋，或調整排序；切換卡片／列表檢視則在「工具」中。</li>
              <li>點擊名片上的 <Icon name="edit" className="h-4 w-4 inline-block mx-1" /> 圖示可修改資訊，點擊 <Icon name="trash" className="h-4 w-4 inline-block mx-1" /> 圖示可刪除名片。</li>
              <li>若名片有照片，點擊照片縮圖可以放大檢視。</li>
              <li>辨識完成後請點「待確認」核對電話與 Email。失敗時可重新辨識或手動填寫，不必重新拍照。</li>
              <li>點「存到通訊錄」下載聯絡人，或直接點電話、Email、地址以撥號、寄信或開啟地圖。</li>
            </ul>
          </InstructionSection>

          <InstructionSection icon="upload" title="本機資料管理 (離線模式)">
             <ul className="list-disc list-inside space-y-2 text-gray-400">
                <li>若您未登入 Google，所有資料僅儲存在您的目前裝置和瀏覽器中。</li>
                <li>點擊主畫面的 <span className="font-semibold text-blue-400">「工具」</span> 選單，可手動新增名片、備份與匯入匯出。</li>
                <li><strong className="text-green-400">完整備份 (推薦):</strong> 選擇「建立完整備份」，會下載一個 `.json` 檔案，包含所有文字和照片。</li>
                <li><strong className="text-green-400">從備份還原:</strong> 選取 `.json` 檔案後合併匯入，保留現有名片，不以備份覆寫。</li>
                <li><strong>Excel 匯出/匯入:</strong> 提供僅備份/匯入 <span className="font-semibold">純文字資料</span> 的選項。</li>
            </ul>
          </InstructionSection>
        
        </main>
        
        <footer className="mt-6 flex-shrink-0">
             <button
                type="button"
                className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-gray-800 transition-colors"
                onClick={onClose}
              >
                我了解了
            </button>
        </footer>
      </div>
    </div>
  );
};


interface InstructionSectionProps {
    icon: string;
    title: string;
    children: React.ReactNode;
}

const InstructionSection: React.FC<InstructionSectionProps> = ({ icon, title, children }) => {
    return (
    <div>
        <h3 className="text-lg font-semibold text-white flex items-center gap-2 mb-2">
            <Icon name={icon} className="h-6 w-6 text-blue-400" />
            <span>{title}</span>
        </h3>
        {children}
    </div>
)};


export default InstructionsModal;
