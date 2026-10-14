
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { BusinessCard, GoogleUser, SyncStatus } from '../types';
import CardItem from './CardItem';
import CardRowItem from './CardRowItem';
import Icon from './Icon';
import GoogleAuth from './GoogleAuth';
import Spinner from './Spinner';

interface CardListProps {
  cards: BusinessCard[];
  onScanNew: () => void;
  onDeleteCard: (id: string) => void;
  onEditCard: (card: BusinessCard) => void;
  onExportExcel: () => void;
  onImportExcel: () => void;
  onExportJson: () => void;
  onRestoreJson: () => void;
  onClearAll: () => void;
  onShowInstructions: () => void;
  // Cloud Sync Props
  googleUser: GoogleUser | null;
  syncStatus: SyncStatus;
  isGapiReady: boolean;
  onGoogleLogin: () => void;
  onGoogleLogout: () => void;
  onForceSync: () => void;
  spreadsheetId: string | null;
  onLazyImageLoaded?: (id: string, base64: string) => void;
}

const CardList: React.FC<CardListProps> = ({
  cards, onScanNew, onDeleteCard, onEditCard, onExportExcel, onImportExcel, onExportJson, onRestoreJson, onClearAll, onShowInstructions,
  googleUser, syncStatus, isGapiReady, onGoogleLogin, onGoogleLogout, onForceSync, spreadsheetId, onLazyImageLoaded
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [searchCategory, setSearchCategory] = useState('all');
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [sortOrder, setSortOrder] = useState<'time-desc' | 'name-asc'>('time-desc');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCategoryMenuOpen, setIsCategoryMenuOpen] = useState(false);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const categoryMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
            setIsMenuOpen(false);
        }
        if (categoryMenuRef.current && !categoryMenuRef.current.contains(event.target as Node)) {
            setIsCategoryMenuOpen(false);
        }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
        document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Debounce search query to prevent lag on every keystroke
  useEffect(() => {
    const timerId = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 250); // 250ms delay

    return () => {
      clearTimeout(timerId);
    };
  }, [searchQuery]);

  const categoryLabels: { [key: string]: string } = {
    all: '全部欄位',
    name: '姓名',
    company: '公司',
    title: '職稱',
    phone: '電話',
    email: 'Email',
    address: '地址',
    notes: '備註'
  };

  const placeholderTextMap: { [key: string]: string } = {
    all: '搜尋姓名、公司、職稱、備註...',
    name: '依姓名搜尋...',
    company: '依公司搜尋...',
    title: '依職稱搜尋...',
    phone: '依電話搜尋...',
    email: '依 Email 搜尋...',
    address: '依地址搜尋...',
    notes: '依備註搜尋...'
  };

  const filteredAndSortedCards = useMemo(() => {
    const lowercasedQuery = debouncedSearchQuery.toLowerCase();
    
    const filtered = lowercasedQuery
      ? cards.filter(
          (card) => {
              const fieldVal = card[searchCategory as keyof BusinessCard];
              if (searchCategory === 'all') {
                  // Search all relevant text fields
                  return (card.name || '').toLowerCase().includes(lowercasedQuery) ||
                         (card.company || '').toLowerCase().includes(lowercasedQuery) ||
                         (card.title || '').toLowerCase().includes(lowercasedQuery) ||
                         (card.phone || '').toLowerCase().includes(lowercasedQuery) ||
                         (card.email || '').toLowerCase().includes(lowercasedQuery) ||
                         (card.address || '').toLowerCase().includes(lowercasedQuery) ||
                         (card.notes || '').toLowerCase().includes(lowercasedQuery);
              }
              // Search a specific field
              return typeof fieldVal === 'string' && fieldVal.toLowerCase().includes(lowercasedQuery);
          }
        )
      : [...cards];

    return filtered.sort((a, b) => {
        if (sortOrder === 'name-asc') {
            return (a.name || '').localeCompare(b.name || '', 'zh-Hant');
        }
        // Default to 'time-desc'
        return (b.timestamp || 0) - (a.timestamp || 0);
    });
  }, [cards, debouncedSearchQuery, sortOrder, searchCategory]);
  
  const menuItems: Array<{ type?: 'divider', label?: string; action?: () => void; disabled?: boolean; icon?: string; isDanger?: boolean, title?: string }> = [];

  // Instructions
  menuItems.push({ label: '使用說明', action: onShowInstructions, disabled: false, icon: 'question-mark-circle' });
  menuItems.push({ type: 'divider' });
  
  // Cloud-specific items
  if (googleUser) {
    menuItems.push({ label: '在 Sheets 中開啟', action: () => { if(spreadsheetId) window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`, '_blank'); }, disabled: !spreadsheetId, icon: 'table-cells' });
    menuItems.push({ label: '手動與雲端同步', action: onForceSync, disabled: syncStatus === SyncStatus.SYNCING, icon: 'sync' });
    menuItems.push({ type: 'divider' });
  }

  // Generic import/export
  menuItems.push({ label: '從 Excel 匯入 (僅文字)', action: onImportExcel, disabled: false, icon: 'upload' });
  menuItems.push({ label: '匯出為 Excel (僅文字)', action: onExportExcel, disabled: cards.length === 0, icon: 'download' });
  
  // Local backup/restore
  menuItems.push({ label: '從備份還原 (含圖片)', action: onRestoreJson, disabled: !!googleUser, icon: 'upload', title: !!googleUser ? "雲端同步模式下禁用此功能" : "" });
  menuItems.push({ label: '建立完整備份 (含圖片)', action: onExportJson, disabled: cards.length === 0 || !!googleUser, icon: 'save', title: !!googleUser ? "雲端同步模式下禁用此功能" : "" });
  
  // Danger zone
  menuItems.push({ type: 'divider' });
  menuItems.push({ label: '清除所有資料', action: () => { if(cards.length > 0) { onClearAll(); setIsMenuOpen(false); } }, disabled: cards.length === 0, icon: 'trash', isDanger: true });


  const getSyncStatusIndicator = () => {
    const statusMap = {
      [SyncStatus.READY_TO_SYNC]: { icon: 'cloud', color: 'text-blue-400', title: '已連線至雲端，等待同步' },
      [SyncStatus.SYNCED]: { icon: 'cloud-check', color: 'text-green-400', title: '已同步至雲端' },
      [SyncStatus.SYNCING]: { icon: 'cloud-arrow-up', color: 'text-yellow-400', title: '同步中...' },
      [SyncStatus.ERROR]: { icon: 'cloud-x', color: 'text-red-400', title: '同步失敗' },
      [SyncStatus.LOCAL]: { icon: 'desktop-computer', color: 'text-blue-400', title: '使用本機儲存' },
      [SyncStatus.UNINITIALIZED]: { icon: 'cloud-off', color: 'text-gray-500', title: '未登入' },
    };
    const currentStatus = googleUser ? syncStatus : SyncStatus.LOCAL;
    const { icon, color, title } = statusMap[currentStatus] || statusMap[SyncStatus.UNINITIALIZED];

    return <div title={title}><Icon name={icon} className={`h-7 w-7 ${color} ${currentStatus === SyncStatus.SYNCING ? 'animate-pulse' : ''}`}/></div>;
  }

  const renderEmptyState = () => {
    if (googleUser && (syncStatus === SyncStatus.READY_TO_SYNC || syncStatus === SyncStatus.SYNCING) && cards.length === 0) {
      const isSyncing = syncStatus === SyncStatus.SYNCING;
      return (
        <div className="text-center py-16 animate-fade-in">
          <Icon name={isSyncing ? "cloud-arrow-up" : "cloud"} className={`h-16 w-16 mx-auto text-gray-600 mb-4 ${isSyncing ? 'animate-pulse' : ''}`} />
          <h3 className="text-xl font-medium text-white">{isSyncing ? '正在同步資料...' : '已連線至 Google 雲端'}</h3>
          <p className="text-gray-400 mt-2 mb-6 max-w-md mx-auto">{isSyncing ? '請稍候，正在從您的雲端下載名片。' : '您的雲端資料庫已就緒。請從「資料管理」選單中選擇「手動與雲端同步」來下載您的名片。'}</p>
        </div>
      );
    }
    return (
      <div className="text-center py-16">
        <Icon name="user" className="h-16 w-16 mx-auto text-gray-600 mb-4" />
        <h3 className="text-xl font-medium text-white">尚未建立名片</h3>
        <p className="text-gray-400 mt-2">點擊下方的「掃描名片」按鈕來掃描您的第一張名片吧！</p>
      </div>
    );
  };


  return (
    <div className="h-full w-full max-w-7xl mx-auto flex flex-col">
      <header className="flex-shrink-0 sticky top-0 z-20 bg-gray-900/80 backdrop-blur-md px-4 pt-4 pb-4">
        <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-3">
              {getSyncStatusIndicator()}
              <h1 className="text-3xl font-bold text-white">名片管家</h1>
            </div>
            <GoogleAuth user={googleUser} syncStatus={syncStatus} onLogin={onGoogleLogin} onLogout={onGoogleLogout} isGapiReady={isGapiReady} />
        </div>
        
        {/* Main Action Bar */}
        <div className="flex justify-between items-center gap-2 sm:gap-4">
            {/* Left Actions */}
            <div className="relative" ref={menuRef}>
              <button
                  onClick={() => setIsMenuOpen(prev => !prev)}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm"
                  aria-haspopup="true"
                  aria-expanded={isMenuOpen}
                  title="資料管理與設定"
              >
                  <Icon name="upload" className="h-5 w-5" />
                  <span className="hidden sm:inline">資料管理</span>
                  <Icon name="chevron-down" className="h-4 w-4" />
              </button>
              {isMenuOpen && (
                  <div className="absolute left-0 mt-2 w-64 origin-top-left bg-gray-800 border border-gray-700 rounded-md shadow-lg z-20 animate-fade-in-down">
                      <div className="py-1" role="menu" aria-orientation="vertical" aria-labelledby="options-menu">
                          {menuItems.map((item, index) => {
                               if (item.type === 'divider') {
                                   return <div key={`divider-${index}`} className="border-t border-gray-700 my-1"></div>;
                               }
                               const itemClasses = `flex items-center gap-3 px-4 py-2 text-sm ${
                                   item.disabled ? 'text-gray-500 cursor-not-allowed' :
                                   item.isDanger ? 'text-red-400 hover:bg-red-900/50 hover:text-red-300' :
                                   'text-gray-200 hover:bg-gray-700'
                               }`;
                               return (
                                   <a
                                      key={item.label}
                                      href="#"
                                      title={item.title || ""}
                                      onClick={(e) => { e.preventDefault(); if(!item.disabled && item.action) { item.action(); setIsMenuOpen(false); } }}
                                      className={itemClasses}
                                      role="menuitem"
                                      aria-disabled={item.disabled}
                                  >
                                      <Icon name={item.icon!} className="h-5 w-5" />
                                      <span>{item.label}</span>
                                  </a>
                               )
                          })}
                      </div>
                  </div>
              )}
            </div>
          
          {/* Right Actions */}
          <div className="flex items-center gap-2 sm:gap-4">
              <button
                onClick={() => setIsSearchVisible(prev => !prev)}
                className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm ${isSearchVisible ? 'bg-blue-600 text-white' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                aria-label="顯示或隱藏搜尋面板"
                title="搜尋與篩選"
              >
                  <Icon name="search" className="h-5 w-5" />
                   <span className="font-medium hidden sm:inline">篩選與搜尋</span>
              </button>
              <button
                  onClick={onScanNew}
                  className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus:ring-4 focus:ring-blue-500/50"
                  aria-label="掃描新名片"
              >
                  <Icon name="camera" className="h-6 w-6" />
                  <span className="font-medium hidden sm:inline">掃描名片</span>
              </button>
          </div>
        </div>
        
        {/* Collapsible Search Panel */}
        {isSearchVisible &&
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-4 animate-fade-in-down">
            <div className="w-full flex-grow flex flex-col sm:flex-row items-center gap-2">
                <div className="relative flex-shrink-0 w-full sm:w-auto" ref={categoryMenuRef}>
                    <button
                        onClick={() => setIsCategoryMenuOpen(prev => !prev)}
                        className="w-full sm:w-auto flex items-center justify-between sm:justify-center gap-2 px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-full hover:bg-gray-700 transition-colors text-sm"
                        aria-haspopup="true"
                        aria-expanded={isCategoryMenuOpen}
                        title="選擇搜尋欄位"
                    >
                        <span>{categoryLabels[searchCategory]}</span>
                        <Icon name="chevron-down" className="h-4 w-4" />
                    </button>
                    {isCategoryMenuOpen && (
                        <div className="absolute left-0 mt-2 w-full sm:w-48 origin-top-left bg-gray-800 border border-gray-700 rounded-md shadow-lg z-20 animate-fade-in-down">
                            <div className="py-1" role="menu" aria-orientation="vertical">
                                {Object.entries(categoryLabels).map(([key, label]) => (
                                    <a
                                        key={key}
                                        href="#"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            setSearchCategory(key);
                                            setIsCategoryMenuOpen(false);
                                        }}
                                        className={`block px-4 py-2 text-sm ${searchCategory === key ? 'bg-blue-600 text-white' : 'text-gray-200 hover:bg-gray-700'}`}
                                        role="menuitem"
                                    >
                                        {label}
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
                <div className="relative flex-grow w-full">
                  <input
                    type="text"
                    placeholder={placeholderTextMap[searchCategory]}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-full py-3 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
                    <Icon name="search" className="h-5 w-5" />
                  </div>
                </div>
            </div>
            <div className="flex-shrink-0 flex items-center bg-gray-800 rounded-full p-1 border border-gray-700">
                <span className="text-xs text-gray-400 font-semibold px-2">排序</span>
                <button 
                  onClick={() => setSortOrder('time-desc')} 
                  className={`px-3 py-1.5 rounded-full transition-colors text-sm ${sortOrder === 'time-desc' ? 'bg-blue-600 text-white shadow' : 'text-gray-300 hover:bg-gray-700'}`}
                  aria-label="依時間排序"
                  title="依時間排序 (新→舊)"
                >
                  時間
                </button>
                <button 
                  onClick={() => setSortOrder('name-asc')} 
                  className={`px-3 py-1.5 rounded-full transition-colors text-sm ${sortOrder === 'name-asc' ? 'bg-blue-600 text-white shadow' : 'text-gray-300 hover:bg-gray-700'}`}
                  aria-label="依姓名排序"
                  title="依姓名筆劃排序"
                >
                  姓名
                </button>
                <div className="w-px h-4 bg-gray-600 mx-2"></div>
                <button 
                  onClick={() => setViewMode('card')} 
                  className={`p-2 rounded-full transition-colors ${viewMode === 'card' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:bg-gray-700'}`}
                  aria-label="卡片檢視"
                  title="卡片檢視"
                >
                  <Icon name="squares-2x2" className="h-5 w-5" />
                </button>
                <button 
                  onClick={() => setViewMode('list')}
                  className={`p-2 rounded-full transition-colors ${viewMode === 'list' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:bg-gray-700'}`}
                  aria-label="列表檢視"
                  title="列表檢視"
                >
                  <Icon name="bars-3" className="h-5 w-5" />
                </button>
            </div>
          </div>
        }
      </header>

      <main className="flex-grow overflow-y-auto px-4 pb-4">
        {filteredAndSortedCards.length > 0 ? (
          <>
            {viewMode === 'card' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredAndSortedCards.map((card) => (
                  <CardItem key={card.id} card={card} onDelete={onDeleteCard} onEdit={onEditCard} onLazyImageLoaded={onLazyImageLoaded} />
                ))}
              </div>
            )}
            {viewMode === 'list' && (
               <div className="bg-gray-800/60 rounded-lg">
                <div className="hidden md:grid md:grid-cols-[minmax(0,2fr),minmax(0,1.5fr),minmax(0,2fr),minmax(0,0.5fr)] md:gap-4 px-4 py-2 bg-gray-700/50 text-xs font-bold text-gray-400 uppercase tracking-wider rounded-t-lg">
                  <span>姓名 / 公司</span>
                  <span>職稱</span>
                  <span>聯絡資訊</span>
                  <span className="text-right">操作</span>
                </div>
                <div className="divide-y divide-gray-700">
                  {filteredAndSortedCards.map((card) => (
                    <CardRowItem key={card.id} card={card} onDelete={onDeleteCard} onEdit={onEditCard} />
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          renderEmptyState()
        )}
      </main>
    </div>
  );
};

export default CardList;
