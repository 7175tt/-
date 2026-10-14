import React, { useState, useMemo, useRef, useEffect } from 'react';
import { BusinessCard, GoogleUser, SyncStatus } from '../types';
import CardItem from './CardItem';
import CardRowItem from './CardRowItem';
import Icon from './Icon';
import GoogleAuth from './GoogleAuth';
import { matchesCard } from '../services/cardSearch';
import { downloadVCard } from '../services/contactExport';

interface CardListProps {
  cards: BusinessCard[];
  onScanNew: () => void;
  onAddManual?: () => void;
  onRetryCard?: (card: BusinessCard) => void;
  onDeleteCard: (id: string) => void;
  onEditCard: (card: BusinessCard) => void;
  onExportExcel: () => void;
  onImportExcel: () => void;
  onExportJson: () => void;
  onRestoreJson: () => void;
  onClearAll: () => void;
  onShowInstructions: () => void;
  googleUser: GoogleUser | null;
  syncStatus: SyncStatus;
  isGapiReady: boolean;
  onGoogleLogin: () => void;
  onGoogleLogout: () => void;
  onForceSync: () => void;
  spreadsheetId: string | null;
  onLazyImageLoaded?: (id: string, base64: string) => void;
  canLoadCloudImages?: boolean;
}

const categoryLabels: Record<string, string> = {
  all: '全部欄位', name: '姓名', company: '公司', title: '職稱', phone: '電話',
  email: 'Email', address: '地址', notes: '備註', rawText: '辨識原文',
};

const CardList: React.FC<CardListProps> = ({
  cards, onScanNew, onAddManual, onRetryCard, onDeleteCard, onEditCard, onExportExcel,
  onImportExcel, onExportJson, onRestoreJson, onClearAll, onShowInstructions,
  googleUser, syncStatus, isGapiReady, onGoogleLogin, onGoogleLogout, onForceSync,
  spreadsheetId, onLazyImageLoaded, canLoadCloudImages = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCategory, setSearchCategory] = useState('all');
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [sortOrder, setSortOrder] = useState<'time-desc' | 'name-asc'>('time-desc');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showSearchOptions, setShowSearchOptions] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setIsMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const filteredAndSortedCards = useMemo(() => cards
    .filter(card => matchesCard(card, searchQuery, searchCategory))
    .sort((a, b) => sortOrder === 'name-asc'
      ? (a.name || '').localeCompare(b.name || '', 'zh-Hant')
      : (b.timestamp || 0) - (a.timestamp || 0)), [cards, searchQuery, searchCategory, sortOrder]);
  const exportableCards = filteredAndSortedCards.filter(card => !card.isProcessing && !card.isError);
  const hasSearch = searchQuery.trim().length > 0;
  const pendingCount = cards.filter(card => card.needsReview && !card.isProcessing && !card.isError).length;

  const menuItems: Array<{ label: string; action: () => void; disabled?: boolean; icon: string; danger?: boolean; title?: string }> = [
    { label: '使用說明', action: onShowInstructions, icon: 'question-mark-circle' },
    ...(googleUser ? [
      { label: '在 Sheets 中開啟', action: () => { if (spreadsheetId) window.open(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}`, '_blank', 'noopener,noreferrer'); }, disabled: !spreadsheetId, icon: 'table-cells' },
      { label: '手動與雲端同步', action: onForceSync, disabled: syncStatus === SyncStatus.SYNCING, icon: 'sync' },
    ] : []),
    { label: hasSearch ? '匯出搜尋結果至通訊錄 (.vcf)' : '匯出全部至通訊錄 (.vcf)', action: () => downloadVCard(exportableCards), disabled: exportableCards.length === 0, icon: 'user' },
    { label: '從 Excel 匯入 (僅文字)', action: onImportExcel, icon: 'upload' },
    { label: '匯出為 Excel (僅文字)', action: onExportExcel, disabled: cards.length === 0, icon: 'download' },
    { label: '從備份還原 (含圖片)', action: onRestoreJson, icon: 'upload' },
    { label: '建立完整備份 (含圖片)', action: onExportJson, disabled: cards.length === 0, icon: 'save' },
    { label: '清除所有資料', action: onClearAll, disabled: cards.length === 0, icon: 'trash', danger: true },
  ];

  const statusMap = {
    [SyncStatus.READY_TO_SYNC]: { icon: 'cloud', color: 'text-blue-400', label: '等待雲端同步' },
    [SyncStatus.SYNCED]: { icon: 'cloud-check', color: 'text-green-400', label: '已同步至雲端' },
    [SyncStatus.SYNCING]: { icon: 'cloud-arrow-up', color: 'text-yellow-400', label: '雲端同步中…' },
    [SyncStatus.ERROR]: { icon: 'cloud-x', color: 'text-red-400', label: '雲端同步失敗，請重試' },
    [SyncStatus.LOCAL]: { icon: 'desktop-computer', color: 'text-blue-400', label: '儲存在此裝置' },
    [SyncStatus.UNINITIALIZED]: { icon: 'cloud-off', color: 'text-gray-400', label: '尚未連線至雲端' },
  };
  const status = statusMap[googleUser ? syncStatus : SyncStatus.LOCAL] || statusMap[SyncStatus.LOCAL];

  return (
    <div className="h-full w-full max-w-7xl mx-auto flex flex-col">
      <header className="flex-shrink-0 sticky top-0 z-20 bg-gray-900/95 backdrop-blur-md px-4 pt-4 pb-3">
        <div className="flex justify-between items-center gap-2 mb-3">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-white">名片管家</h1>
            <p className={`flex items-center gap-1 text-xs mt-1 ${status.color}`} role="status">
              <Icon name={status.icon} className="h-4 w-4 shrink-0" />{status.label}
            </p>
          </div>
          <GoogleAuth user={googleUser} syncStatus={syncStatus} onLogin={onGoogleLogin} onLogout={onGoogleLogout} isGapiReady={isGapiReady} />
        </div>

        <div className="flex justify-between items-center gap-2">
          <div className="relative" ref={menuRef}>
            <button id="data-menu-toggle" onClick={() => setIsMenuOpen(open => !open)} className="flex items-center gap-1 min-h-11 px-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 text-sm" aria-haspopup="true" aria-expanded={isMenuOpen} aria-label="資料管理與設定" title="資料管理與設定">
              <Icon name="bars-3" className="h-5 w-5" /><span className="hidden sm:inline">資料管理</span>
            </button>
            {isMenuOpen && (
              <div className="absolute left-0 mt-2 w-72 max-w-[calc(100vw-2rem)] max-h-[60vh] overflow-y-auto bg-gray-800 border border-gray-700 rounded-xl shadow-lg z-30" aria-labelledby="data-menu-toggle">
                {menuItems.map(item => (
                  <button key={item.label} type="button" title={item.title} disabled={item.disabled} onClick={() => { item.action(); setIsMenuOpen(false); }} className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm disabled:text-gray-500 disabled:cursor-not-allowed ${item.danger ? 'text-red-400 border-t border-gray-700 hover:bg-red-900/30' : 'text-gray-200 hover:bg-gray-700'}`}>
                    <Icon name={item.icon} className="h-5 w-5 shrink-0" /><span>{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onAddManual && <button onClick={onAddManual} className="min-h-11 px-3 text-sm text-gray-200 bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700" aria-label="手動新增名片">手動新增</button>}
            <button onClick={onScanNew} className="flex items-center justify-center gap-2 min-h-11 px-3 sm:px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus-visible:ring-4 focus-visible:ring-blue-500/50" aria-label="掃描新名片">
              <Icon name="camera" className="h-5 w-5" /><span className="font-medium">掃描名片</span>
            </button>
          </div>
        </div>

        <div className="flex gap-2 mt-3">
          <div className="relative flex-grow min-w-0">
            <label className="sr-only" htmlFor="card-search">搜尋名片</label>
            <input id="card-search" type="search" placeholder="搜尋姓名、公司、電話或備註" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} autoComplete="off" className="w-full min-h-11 bg-gray-800 border border-gray-700 text-white rounded-lg py-2 pl-10 pr-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <Icon name="search" className="absolute left-3 top-3 h-5 w-5 text-gray-400 pointer-events-none" />
          </div>
          <button onClick={() => setShowSearchOptions(show => !show)} className={`min-h-11 px-3 rounded-lg text-sm ${showSearchOptions || searchCategory !== 'all' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 border border-gray-700'}`} aria-expanded={showSearchOptions} aria-controls="search-options" aria-label="顯示或隱藏搜尋選項"><Icon name="adjustments-horizontal" className="h-5 w-5" /></button>
        </div>
        {showSearchOptions && (
          <div id="search-options" className="flex flex-wrap items-center gap-2 mt-2">
            <label className="sr-only" htmlFor="search-category">選擇搜尋欄位</label>
            <select id="search-category" value={searchCategory} onChange={event => setSearchCategory(event.target.value)} className="min-h-11 max-w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 text-sm">
              {Object.entries(categoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1">
              <button onClick={() => setSortOrder('time-desc')} className={`min-h-9 px-3 rounded text-sm ${sortOrder === 'time-desc' ? 'bg-blue-600 text-white' : 'text-gray-300'}`} aria-label="依時間排序" aria-pressed={sortOrder === 'time-desc'}>最新</button>
              <button onClick={() => setSortOrder('name-asc')} className={`min-h-9 px-3 rounded text-sm ${sortOrder === 'name-asc' ? 'bg-blue-600 text-white' : 'text-gray-300'}`} aria-label="依姓名排序" aria-pressed={sortOrder === 'name-asc'}>姓名</button>
            </div>
          </div>
        )}
        <div className="flex justify-between items-center gap-2 mt-2">
          <p className="text-xs text-gray-400" role="status" aria-live="polite">
            {hasSearch ? `找到 ${filteredAndSortedCards.length} 張／共 ${cards.length} 張` : `共 ${cards.length} 張名片`}
            {searchCategory !== 'all' && <span> · 搜尋{categoryLabels[searchCategory]}</span>}
            {pendingCount > 0 && <span className="text-amber-300"> · {pendingCount} 張待確認</span>}
          </p>
          <div className="flex shrink-0 text-gray-400">
            <button onClick={() => setViewMode('card')} className={`p-2 rounded ${viewMode === 'card' ? 'bg-gray-700 text-white' : ''}`} aria-label="卡片檢視" aria-pressed={viewMode === 'card'}><Icon name="squares-2x2" className="h-5 w-5" /></button>
            <button onClick={() => setViewMode('list')} className={`p-2 rounded ${viewMode === 'list' ? 'bg-gray-700 text-white' : ''}`} aria-label="列表檢視" aria-pressed={viewMode === 'list'}><Icon name="bars-3" className="h-5 w-5" /></button>
          </div>
        </div>
      </header>

      <main className="flex-grow overflow-y-auto px-4 pb-6">
        {filteredAndSortedCards.length > 0 ? viewMode === 'card' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAndSortedCards.map(card => <CardItem key={card.id} card={card} onDelete={onDeleteCard} onEdit={onEditCard} onRetryCard={onRetryCard} onLazyImageLoaded={onLazyImageLoaded} canLoadCloudImages={canLoadCloudImages && card.cloudAccount === googleUser?.email} />)}
          </div>
        ) : (
          <div className="bg-gray-800/60 rounded-lg divide-y divide-gray-700">
            {filteredAndSortedCards.map(card => <CardRowItem key={card.id} card={card} onDelete={onDeleteCard} onEdit={onEditCard} onRetryCard={onRetryCard} />)}
          </div>
        ) : hasSearch ? (
          <div className="text-center py-12">
            <Icon name="search" className="h-12 w-12 mx-auto text-gray-600 mb-3" />
            <h2 className="text-lg font-semibold text-white">找不到符合的名片</h2>
            <p className="text-gray-400 mt-2 text-sm">試試公司、電話末碼、備註或辨識原文中的字詞。</p>
            <button onClick={() => { setSearchQuery(''); setSearchCategory('all'); }} className="mt-4 min-h-11 px-4 text-blue-300 hover:text-blue-200">清除搜尋條件</button>
          </div>
        ) : googleUser && syncStatus === SyncStatus.SYNCING ? (
          <div className="text-center py-12 text-gray-300" role="status"><Icon name="cloud-arrow-up" className="h-12 w-12 mx-auto mb-3 animate-pulse" />正在同步您的名片…</div>
        ) : (
          <div className="text-center py-12">
            <Icon name="camera" className="h-14 w-14 mx-auto text-blue-400 mb-4" />
            <h2 className="text-xl font-semibold text-white">把第一張名片收進手機</h2>
            <p className="text-gray-400 mt-2 text-sm leading-relaxed">拍照或選擇照片，辨識後確認資料。<br />之後用姓名、公司或備註，快速找到聯絡人。</p>
            <button onClick={onScanNew} className="mt-5 min-h-11 px-5 rounded-lg bg-blue-600 text-white hover:bg-blue-700">開始掃描</button>
          </div>
        )}
      </main>
    </div>
  );
};

export default CardList;
