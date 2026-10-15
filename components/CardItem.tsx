import React from 'react';
import { BusinessCard } from '../types';
import Icon from './Icon';
import Spinner from './Spinner';
import CardPhoto from './CardPhoto';
import { downloadVCard, getPhoneHref, getEmailHref, getAddressHref } from '../services/contactExport';

interface CardItemProps {
  card: BusinessCard;
  onDelete: (id: string) => void;
  onEdit: (card: BusinessCard) => void;
  onRetryCard?: (card: BusinessCard) => void;
  onLazyImageLoaded?: (card: BusinessCard, base64: string) => void;
  canLoadCloudImages?: boolean;
}

const CardItem: React.FC<CardItemProps> = ({ card, onDelete, onEdit, onRetryCard, onLazyImageLoaded, canLoadCloudImages = false }) => {
  const photoProps = { card, canLoadCloudImages, onImageLoaded: onLazyImageLoaded };

  if (card.isProcessing) {
    return (
      <div className="bg-gray-800 rounded-xl p-4 shadow-lg flex items-center gap-3" role="status" aria-live="polite">
        <CardPhoto {...photoProps} />
        <Spinner className="h-6 w-6 shrink-0" /><div><h3 className="font-bold text-white">正在辨識中…</h3><p className="text-gray-400 text-sm">您可以繼續掃描下一張</p></div>
      </div>
    );
  }

  if (card.isError) {
    return (
      <div className="bg-gray-800 rounded-xl p-4 shadow-lg border border-red-500/50">
        <div className="flex items-start gap-3">
          {card.imageBase64 || card.imageDriveId ? <CardPhoto {...photoProps} alt="辨識未完成的名片" /> : <Icon name="exclamation-triangle" className="h-7 w-7 text-red-400 shrink-0" />}
          <div className="min-w-0 flex-1"><h3 className="font-bold text-red-300">名片辨識未完成</h3><p className="text-gray-300 text-sm mt-1 break-words">{card.errorMessage || '照片已保留，請重新辨識，或手動填寫聯絡資訊。'}</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {onRetryCard && <button onClick={() => onRetryCard(card)} className="min-h-11 px-3 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700" aria-label="重新辨識名片">重新辨識</button>}
          <button onClick={() => onEdit(card)} className="min-h-11 px-3 rounded-lg bg-gray-700 text-white text-sm hover:bg-gray-600">手動填寫</button>
          <button onClick={() => onDelete(card.id)} className="ml-auto p-3 text-gray-400 hover:text-red-400" aria-label="刪除失敗的項目"><Icon name="trash" className="h-5 w-5" /></button>
        </div>
      </div>
    );
  }

  const phoneHref = getPhoneHref(card.phone);
  const emailHref = getEmailHref(card.email);
  const addressHref = getAddressHref(card.address);

  return (
    <>
      <article className="bg-gray-800 rounded-xl p-4 shadow-lg flex flex-col min-w-0">
        <div className="flex justify-between items-start gap-3">
          <div className="min-w-0 flex-grow">
            <h3 className="text-xl font-bold text-white break-words">{card.name || card.company || '未命名聯絡人'}</h3>
            {card.title && <p className="text-blue-300 font-medium break-words">{card.title}</p>}
            {card.company && <p className="text-gray-300 mt-1 break-words">{card.company}</p>}
            {card.needsReview && <button onClick={() => onEdit(card)} className="inline-flex mt-2 px-2 py-1 text-xs font-medium rounded bg-amber-500/15 text-amber-300 border border-amber-400/30" aria-label={`確認 ${card.name || '這張名片'} 的辨識結果`}>待確認 · 檢查辨識結果</button>}
          </div>
          <CardPhoto {...photoProps} />
        </div>
        <div className="mt-3 space-y-1 text-sm text-gray-300">
          {card.phone && <div className="flex items-start gap-2"><Icon name="phone" className="h-4 w-4 mt-3 text-gray-400 shrink-0" />{phoneHref ? <a href={phoneHref} className="py-2 hover:text-blue-300 break-all">{card.phone}</a> : <span className="py-2 break-all">{card.phone}</span>}</div>}
          {card.email && <div className="flex items-start gap-2"><Icon name="mail" className="h-4 w-4 mt-3 text-gray-400 shrink-0" />{emailHref ? <a href={emailHref} className="py-2 hover:text-blue-300 break-all">{card.email}</a> : <span className="py-2 break-all">{card.email}</span>}</div>}
          {card.address && <div className="flex items-start gap-2"><Icon name="company" className="h-4 w-4 mt-3 text-gray-400 shrink-0" />{addressHref ? <a href={addressHref} target="_blank" rel="noopener noreferrer" className="py-2 hover:text-blue-300 break-words" aria-label={`在地圖開啟 ${card.address}`}>{card.address}</a> : <span className="py-2 break-words">{card.address}</span>}</div>}
        </div>
        {card.notes && <p className="mt-3 pt-3 border-t border-gray-700 text-sm text-gray-300 whitespace-pre-wrap break-words">{card.notes}</p>}
        <div className="mt-auto pt-3 flex items-center justify-between gap-2">
          <button onClick={() => downloadVCard([card])} className="flex items-center gap-1 min-h-11 px-2 text-sm text-blue-300 hover:bg-gray-700 rounded-lg" aria-label={`將 ${card.name || '這張名片'} 存到通訊錄`}><Icon name="download" className="h-4 w-4" />存到通訊錄</button>
          <div className="flex text-gray-400">
            <button onClick={() => onEdit(card)} className="p-3 hover:text-blue-300 hover:bg-gray-700 rounded-lg" aria-label={`編輯 ${card.name} 的名片`}><Icon name="edit" className="h-5 w-5" /></button>
            <button onClick={() => onDelete(card.id)} className="p-3 hover:text-red-400 hover:bg-gray-700 rounded-lg" aria-label={`刪除 ${card.name} 的名片`}><Icon name="trash" className="h-5 w-5" /></button>
          </div>
        </div>
      </article>
    </>
  );
};

export default CardItem;
