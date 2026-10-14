import React, { useState, useEffect, useRef } from 'react';
import { BusinessCard } from '../types';
import Icon from './Icon';
import Spinner from './Spinner';
import { downloadVCard, getPhoneHref, getEmailHref, getAddressHref } from '../services/contactExport';

interface CardItemProps {
  card: BusinessCard;
  onDelete: (id: string) => void;
  onEdit: (card: BusinessCard) => void;
  onRetryCard?: (card: BusinessCard) => void;
  onLazyImageLoaded?: (id: string, base64: string) => void;
  canLoadCloudImages?: boolean;
}

const CardItem: React.FC<CardItemProps> = ({ card, onDelete, onEdit, onRetryCard, onLazyImageLoaded, canLoadCloudImages = false }) => {
  const [showImageModal, setShowImageModal] = useState(false);
  const [lazyImage, setLazyImage] = useState<{ key: string; base64: string } | null>(null);
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [imageRequest, setImageRequest] = useState(0);
  const closePreviewRef = useRef<HTMLButtonElement>(null);
  const onImageLoadedRef = useRef(onLazyImageLoaded);
  const imageKey = `${card.id}:${card.cloudAccount || ''}:${card.imageDriveId || ''}`;
  const base64 = card.imageBase64 || (canLoadCloudImages && lazyImage?.key === imageKey ? lazyImage.base64 : null);
  const imageUrl = base64 ? `data:image/jpeg;base64,${base64}` : null;

  useEffect(() => { onImageLoadedRef.current = onLazyImageLoaded; }, [onLazyImageLoaded]);
  // Fetch cloud photos only when requested. A failed request does not loop on every render.
  useEffect(() => {
    setImageLoadFailed(false);
    if (!imageRequest || card.imageBase64 || !card.imageDriveId || !canLoadCloudImages) {
      setIsLoadingImage(false);
      return;
    }
    let cancelled = false;
    setIsLoadingImage(true);
    import('../services/googleApiService').then(api => api.getImageAsBase64(card.imageDriveId!))
      .then(image => {
        if (cancelled) return;
        if (!image) throw new Error('照片尚未下載');
        setLazyImage({ key: imageKey, base64: image });
        onImageLoadedRef.current?.(card.id, image);
      })
      .catch(() => { if (!cancelled) setImageLoadFailed(true); })
      .finally(() => { if (!cancelled) setIsLoadingImage(false); });
    return () => { cancelled = true; };
  }, [imageKey, card.id, card.imageBase64, card.imageDriveId, canLoadCloudImages, imageRequest]);

  useEffect(() => {
    if (!showImageModal || !imageUrl) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closePreviewRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowImageModal(false);
      if (event.key === 'Tab') { event.preventDefault(); closePreviewRef.current?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); previousFocus?.focus(); };
  }, [showImageModal, imageUrl]);

  if (card.isProcessing) {
    return (
      <div className="bg-gray-800 rounded-xl p-4 shadow-lg flex items-center gap-3" role="status" aria-live="polite">
        {imageUrl && <img src={imageUrl} alt="名片縮圖" className="w-20 h-14 object-cover rounded-md border border-gray-700" />}
        <Spinner className="h-6 w-6 shrink-0" /><div><h3 className="font-bold text-white">正在辨識中…</h3><p className="text-gray-400 text-sm">您可以繼續掃描下一張</p></div>
      </div>
    );
  }

  if (card.isError) {
    return (
      <div className="bg-gray-800 rounded-xl p-4 shadow-lg border border-red-500/50">
        <div className="flex items-start gap-3">
          {imageUrl ? <img src={imageUrl} alt="辨識未完成的名片" className="w-20 h-14 object-cover rounded-md" /> : <Icon name="exclamation-triangle" className="h-7 w-7 text-red-400 shrink-0" />}
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
          <div className="shrink-0">
            {imageUrl ? (
              <button onClick={() => setShowImageModal(true)} aria-label="查看名片照片"><img src={imageUrl} alt="名片縮圖" className="w-20 h-14 object-cover rounded-md border border-gray-600 hover:border-blue-500" loading="lazy" /></button>
            ) : card.imageDriveId && canLoadCloudImages ? (
              <button onClick={() => { setImageRequest(count => count + 1); setShowImageModal(true); }} disabled={isLoadingImage} className="w-20 min-h-14 flex flex-col items-center justify-center gap-1 rounded-md border border-gray-600 text-gray-300 text-xs disabled:opacity-60" aria-label={imageLoadFailed ? '重新載入名片照片' : '載入名片照片'}>
                {isLoadingImage ? <Spinner className="h-5 w-5" /> : <Icon name="camera" className="h-5 w-5" />}
                {isLoadingImage ? '載入中' : imageLoadFailed ? '重試照片' : '查看照片'}
              </button>
            ) : null}
          </div>
        </div>
        {imageLoadFailed && <p className="text-xs text-amber-300 mt-2" role="status">照片暫時無法載入，請檢查連線後重試。</p>}
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
      {showImageModal && imageUrl && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4" onClick={() => setShowImageModal(false)} role="dialog" aria-modal="true" aria-label="名片照片預覽">
          <img src={imageUrl} alt={`${card.name || '聯絡人'} 的名片`} className="max-w-[90vw] max-h-[80dvh] object-contain rounded-lg" onClick={event => event.stopPropagation()} />
          <button ref={closePreviewRef} onClick={() => setShowImageModal(false)} className="absolute top-4 right-4 p-3 text-white rounded-full bg-gray-800" aria-label="關閉預覽"><Icon name="x-mark" className="h-6 w-6" /></button>
        </div>
      )}
    </>
  );
};

export default CardItem;
