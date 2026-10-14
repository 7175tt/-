
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
              <li>點擊主畫面的 <span className="font-semibold text-blue-400">「掃描名片」</span> 按鈕。</li>
              <li>將名片完整對準畫面中的 <span className="font-semibold text-yellow-400">提示框線</span>。</li>
              <li>點擊圓形拍照鈕即可拍攝。系統只會擷取框線內的影像進行辨識。</li>
              <li>每拍完一張，AI 就會 <span className="font-semibold text-green-400">立即在背景開始辨識</span>，您不需等待。</li>
              <li>您可以無縫地繼續拍攝下一張名片。</li>
              <li>全部拍攝完成後，點擊左上角的 <span className="font-semibold text-blue-400">「完成」</span> 按鈕返回主畫面查看結果。</li>
            </ul>
          </InstructionSection>

           <InstructionSection icon="cloud-check" title="雲端同步 (推薦)">
            <ul className="list-disc list-inside space-y-2 text-gray-400">
              <li>點擊主畫面右上角的 <span className="font-semibold text-blue-400">「使用 Google 登入」</span> 按鈕。</li>
              <li>授權後，您的所有名片資料（含照片）將會安全地儲存在您自己的 Google Sheets 和 Google Drive 中。</li>
              <li><strong className="text-green-400">資料位置：</strong>文字資料儲存在一個名為「名片管家資料庫」的 Google Sheet 中；照片則在「名片管家照片」資料夾。</li>
              <li>登入後，您可以從「資料管理」選單中找到「在 Sheets 中開啟」的選項，直接在瀏覽器新分頁中開啟您的資料庫。</li>
              <li><strong className="text-yellow-400">重要：</strong>登入後，您的資料並不會馬上出現。請從「資料管理」選單中，選擇「手動與雲端同步」來下載您的雲端名片。</li>
              <li><strong className="text-green-400">優點：</strong>跨裝置同步、永久備份、資料所有權完全歸您。</li>
              <li>首次登入時，系統會詢問是否將您裝置上的現有名片上傳至雲端。</li>
            </ul>
          </InstructionSection>

          <InstructionSection icon="search" title="管理與搜尋">
             <ul className="list-disc list-inside space-y-2 text-gray-400">
              <li>點擊主畫面的 <span className="font-semibold text-blue-400">「篩選與搜尋」</span> 按鈕 <Icon name="search" className="h-4 w-4 inline-block mx-1" /> 來展開搜尋面板。</li>
              <li>您可以使用搜尋框左邊的下拉選單，針對「姓名」、「公司」等特定欄位進行更精準的搜尋。</li>
              <li>點擊名片上的 <Icon name="edit" className="h-4 w-4 inline-block mx-1" /> 圖示可修改資訊，點擊 <Icon name="trash" className="h-4 w-4 inline-block mx-1" /> 圖示可刪除名片。</li>
              <li>若名片有照片，點擊照片縮圖可以放大檢視。</li>
            </ul>
          </InstructionSection>

          <InstructionSection icon="upload" title="本機資料管理 (離線模式)">
             <ul className="list-disc list-inside space-y-2 text-gray-400">
                <li>若您未登入 Google，所有資料僅儲存在您的目前裝置和瀏覽器中。</li>
                <li>點擊主畫面的 <span className="font-semibold text-blue-400">「資料管理」</span> 選單進行操作。</li>
                <li><strong className="text-green-400">完整備份 (推薦):</strong> 選擇「建立完整備份」，會下載一個 `.json` 檔案，包含所有文字和照片。</li>
                <li><strong className="text-green-400">從備份還原:</strong> 選擇「從備份還原」並選取 `.json` 檔案，即可還原資料。</li>
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