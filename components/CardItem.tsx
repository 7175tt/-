import React, { useState } from 'react';
import { BusinessCard } from '../types';
import Icon from './Icon';
import Spinner from './Spinner';
import CardPhoto from './CardPhoto';
import { downloadVCard, getPhoneHref, getEmailHref, getAddressHref } from '../services/contactExport';

export interface CardItemProps {
  card: BusinessCard;
  onDelete: (id: string) => void;
  onEdit: (card: BusinessCard) => void;
  onRetryCard?: (card: BusinessCard) => void;
  onLazyImageLoaded?: (card: BusinessCard, base64: string) => void;
  canLoadCloudImages?: boolean;
  layout?: 'card' | 'row';
}

const CardItem: React.FC<CardItemProps> = ({ card, onDelete, onEdit, onRetryCard, onLazyImageLoaded, canLoadCloudImages = false, layout = 'card' }) => {
  const [expanded, setExpanded] = useState(false);
  const photoProps = { card, canLoadCloudImages, onImageLoaded: onLazyImageLoaded };
  const row = layout === 'row';

  if (card.isProcessing) {
    return (
      <div className="bg-gray-800 rounded-lg p-3 flex items-center gap-3" role="status" aria-live="polite">
        <CardPhoto {...photoProps} /><Spinner className="h-5 w-5 shrink-0" />
        <div><h3 className="font-bold text-white">正在辨識中…</h3><p className="text-gray-400 text-xs">您可以繼續掃描下一張</p></div>
      </div>
    );
  }
  if (card.isError) {
    return (
      <div className="bg-gray-800 rounded-lg p-3 border border-red-500/50">
        <div className="flex items-start gap-2">
          {card.imageBase64 || card.imageLocalId || card.imageDriveId ? <CardPhoto {...photoProps} alt="辨識未完成的名片" /> : <Icon name="exclamation-triangle" className="h-6 w-6 text-red-400 shrink-0" />}
          <div className="min-w-0 flex-1"><h3 className="font-semibold text-red-300">名片辨識未完成</h3><p className="text-gray-300 text-xs mt-1 break-words">{card.errorMessage || '照片已保留，請重新辨識或手動填寫。'}</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {onRetryCard && <button onClick={() => onRetryCard(card)} className="min-h-11 sm:min-h-8 px-2 rounded bg-blue-600 text-white text-xs" aria-label="重新辨識名片">重新辨識</button>}
          <button onClick={() => onEdit(card)} className="min-h-11 sm:min-h-8 px-2 rounded bg-gray-700 text-xs">手動填寫</button>
          <button onClick={() => onDelete(card.id)} className="ml-auto p-2 text-gray-400 hover:text-red-400" aria-label="刪除失敗的項目"><Icon name="trash" className="h-4 w-4" /></button>
        </div>
      </div>
    );
  }

  const phoneHref = getPhoneHref(card.phone);
  const emailHref = getEmailHref(card.email);
  const addressHref = getAddressHref(card.address);
  const textClass = expanded ? 'break-words whitespace-pre-line' : 'truncate';
  const detailsId = `card-details-${card.id}`;

  return (
    <article className={`min-w-0 p-3 ${row ? 'hover:bg-gray-700/20 sm:grid sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] sm:gap-x-4 sm:items-center' : 'bg-gray-800 rounded-lg border border-gray-700/40'}`}>
      <div className="flex justify-between items-start gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <h3 className={`text-base leading-5 font-bold text-white ${textClass}`} title={card.name}>{card.name || card.company || '未命名聯絡人'}</h3>
          {card.title && <p className={`text-blue-300 text-[13px] leading-5 ${textClass}`} title={card.title}>{card.title}</p>}
          {card.company && <p className={`text-gray-300 text-[13px] leading-5 ${textClass}`} title={card.company}>{card.company}</p>}
          {card.needsReview && <button onClick={() => onEdit(card)} className="mt-1 px-1.5 py-0.5 text-xs rounded bg-amber-500/15 text-amber-300" aria-label={`確認 ${card.name || '這張名片'} 的辨識結果`}>待確認</button>}
        </div>
        <CardPhoto {...photoProps} />
      </div>
      <div className={`min-w-0 text-[13px] leading-5 text-gray-300 mt-2 ${row ? 'sm:mt-0' : ''}`}>
        {card.phone && <div className="flex items-start gap-2 min-w-0"><Icon name="phone" className="h-3.5 w-3.5 mt-1 shrink-0 text-gray-400" />{phoneHref ? <a href={phoneHref} title={card.phone} className={`min-w-0 py-0.5 hover:text-blue-300 ${textClass}`}>{card.phone}</a> : <span className={`min-w-0 py-0.5 ${textClass}`}>{card.phone}</span>}</div>}
        {card.email && <div className="flex items-start gap-2 min-w-0"><Icon name="mail" className="h-3.5 w-3.5 mt-1 shrink-0 text-gray-400" />{emailHref ? <a href={emailHref} title={card.email} className={`min-w-0 py-0.5 hover:text-blue-300 ${textClass}`}>{card.email}</a> : <span className={`min-w-0 py-0.5 ${textClass}`}>{card.email}</span>}</div>}
      </div>
      <div className={`flex items-center justify-between gap-1 mt-2 ${row ? 'sm:mt-0 sm:justify-end' : 'pt-1 border-t border-gray-700/50'}`}>
        <button onClick={() => downloadVCard([card])} title="存到通訊錄" className="flex items-center gap-1 min-h-11 sm:min-h-8 px-1 text-xs text-blue-300 rounded hover:bg-gray-700" aria-label={`將 ${card.name || '這張名片'} 存到通訊錄`}><Icon name="download" className="h-4 w-4" /><span>通訊錄</span></button>
        <div className="flex items-center text-gray-400">
          <button onClick={() => setExpanded(value => !value)} className="min-h-11 sm:min-h-8 px-2 text-xs rounded hover:bg-gray-700" aria-expanded={expanded} aria-controls={detailsId} aria-label={`${expanded ? '收合' : '展開'} ${card.name || '這張名片'} 的詳細資訊`}>{expanded ? '收合' : '詳細'}</button>
          <button onClick={() => onEdit(card)} title="編輯名片" className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 grid place-items-center rounded hover:text-blue-300 hover:bg-gray-700" aria-label={`編輯 ${card.name} 的名片`}><Icon name="edit" className="h-4 w-4" /></button>
          <button onClick={() => onDelete(card.id)} title="刪除名片" className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 grid place-items-center rounded hover:text-red-400 hover:bg-gray-700" aria-label={`刪除 ${card.name} 的名片`}><Icon name="trash" className="h-4 w-4" /></button>
        </div>
      </div>
      {expanded && <div id={detailsId} className="sm:col-span-3 mt-2 pt-2 border-t border-gray-700 text-sm text-gray-300 space-y-2">
        {card.address && <div className="flex items-start gap-2"><Icon name="company" className="h-4 w-4 mt-0.5 text-gray-400 shrink-0" />{addressHref ? <a href={addressHref} target="_blank" rel="noopener noreferrer" className="hover:text-blue-300 break-words min-w-0" aria-label={`在地圖開啟 ${card.address}`}>{card.address}</a> : <span className="break-words min-w-0">{card.address}</span>}</div>}
        {card.notes && <p className="whitespace-pre-wrap break-words">{card.notes}</p>}
        {!card.address && !card.notes && <p className="text-xs text-gray-400">沒有其他地址或備註。</p>}
      </div>}
    </article>
  );
};

export default CardItem;
