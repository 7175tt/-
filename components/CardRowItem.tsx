import React from 'react';
import { BusinessCard } from '../types';
import Icon from './Icon';
import Spinner from './Spinner';
import { downloadVCard, getPhoneHref, getEmailHref, getAddressHref } from '../services/contactExport';

interface CardRowItemProps {
  card: BusinessCard;
  onDelete: (id: string) => void;
  onEdit: (card: BusinessCard) => void;
  onRetryCard?: (card: BusinessCard) => void;
}

const CardRowItem: React.FC<CardRowItemProps> = ({ card, onDelete, onEdit, onRetryCard }) => {
  if (card.isProcessing) {
    return <div className="px-4 py-4 flex items-center gap-3" role="status"><Spinner className="h-5 w-5" /><div><p className="font-semibold text-white">正在辨識中…</p><p className="text-sm text-gray-400">您可以繼續掃描下一張</p></div></div>;
  }
  if (card.isError) {
    return (
      <div className="px-4 py-4 bg-red-900/20">
        <div className="flex items-start gap-2"><Icon name="exclamation-triangle" className="h-5 w-5 text-red-400 shrink-0" /><div className="min-w-0"><p className="font-semibold text-red-300">名片辨識未完成</p><p className="text-sm text-gray-300 mt-1 break-words">{card.errorMessage || '照片已保留，可重新辨識或手動填寫。'}</p></div></div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {onRetryCard && <button onClick={() => onRetryCard(card)} className="min-h-11 px-3 bg-blue-600 text-white rounded-lg text-sm" aria-label="重新辨識名片">重新辨識</button>}
          <button onClick={() => onEdit(card)} className="min-h-11 px-3 bg-gray-700 text-white rounded-lg text-sm">手動填寫</button>
          <button onClick={() => onDelete(card.id)} className="ml-auto p-3 text-gray-400 hover:text-red-400" aria-label="刪除失敗的項目"><Icon name="trash" className="h-5 w-5" /></button>
        </div>
      </div>
    );
  }
  const phoneHref = getPhoneHref(card.phone);
  const emailHref = getEmailHref(card.email);
  const addressHref = getAddressHref(card.address);

  return (
    <article className="px-4 py-3 hover:bg-gray-700/30 grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-2 md:gap-4 md:items-center">
      <div className="min-w-0">
        <h3 className="font-semibold text-white break-words">{card.name || card.company || '未命名聯絡人'}</h3>
        <p className="text-sm text-gray-300 break-words">{[card.company, card.title].filter(Boolean).join(' · ')}</p>
        {card.needsReview && <button onClick={() => onEdit(card)} className="mt-1 px-2 py-1 rounded text-xs text-amber-300 bg-amber-500/10" aria-label={`確認 ${card.name || '這張名片'} 的辨識結果`}>待確認 · 檢查辨識結果</button>}
      </div>
      <div className="space-y-1 text-sm text-gray-300 min-w-0">
        {card.phone && <div className="flex items-center gap-2"><Icon name="phone" className="h-4 w-4 shrink-0 text-gray-400" />{phoneHref ? <a href={phoneHref} className="py-1 hover:text-blue-300 break-all">{card.phone}</a> : <span className="break-all">{card.phone}</span>}</div>}
        {card.email && <div className="flex items-center gap-2"><Icon name="mail" className="h-4 w-4 shrink-0 text-gray-400" />{emailHref ? <a href={emailHref} className="py-1 hover:text-blue-300 break-all">{card.email}</a> : <span className="break-all">{card.email}</span>}</div>}
        {card.address && <div className="flex items-start gap-2"><Icon name="company" className="h-4 w-4 mt-1 shrink-0 text-gray-400" />{addressHref ? <a href={addressHref} target="_blank" rel="noopener noreferrer" className="py-1 hover:text-blue-300 break-words" aria-label={`在地圖開啟 ${card.address}`}>{card.address}</a> : <span className="break-words">{card.address}</span>}</div>}
        {card.notes && <p className="text-gray-400 break-words whitespace-pre-wrap">{card.notes}</p>}
      </div>
      <div className="flex items-center justify-between md:justify-end text-gray-400">
        <button onClick={() => downloadVCard([card])} className="min-h-11 flex gap-1 items-center px-2 text-blue-300 text-sm rounded-lg hover:bg-gray-700" aria-label={`將 ${card.name || '這張名片'} 存到通訊錄`}><Icon name="download" className="h-4 w-4" /><span className="md:hidden">存到通訊錄</span></button>
        <div className="flex">
          <button onClick={() => onEdit(card)} className="p-3 hover:text-blue-300 rounded-lg hover:bg-gray-700" aria-label={`編輯 ${card.name} 的名片`}><Icon name="edit" className="h-5 w-5" /></button>
          <button onClick={() => onDelete(card.id)} className="p-3 hover:text-red-400 rounded-lg hover:bg-gray-700" aria-label={`刪除 ${card.name} 的名片`}><Icon name="trash" className="h-5 w-5" /></button>
        </div>
      </div>
    </article>
  );
};

export default CardRowItem;
