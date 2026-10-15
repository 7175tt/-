import React, { useEffect, useRef, useState } from 'react';
import type { BusinessCard } from '../types';
import { getCardPhotoUrl } from '../services/cardPhoto';
import { getImageAsBase64 } from '../services/googleApiService';
import Icon from './Icon';
import Spinner from './Spinner';

export interface CardPhotoProps {
  card: BusinessCard;
  canLoadCloudImages?: boolean;
  onImageLoaded?: (card: BusinessCard, base64: string) => void;
  variant?: 'thumbnail' | 'full';
  alt?: string;
}

/** The same photo and recovery controls in cards, rows, and the edit form. */
const CardPhoto: React.FC<CardPhotoProps> = ({ card, canLoadCloudImages = false, onImageLoaded, variant = 'thumbnail', alt = '名片縮圖' }) => {
  const [showPreview, setShowPreview] = useState(false);
  const [request, setRequest] = useState(0);
  const [download, setDownload] = useState<{ key: string; base64: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const loadedRef = useRef(onImageLoaded);
  loadedRef.current = onImageLoaded;
  const key = JSON.stringify([card.id, card.cloudAccount, card.imageDriveId]);
  const localUrl = getCardPhotoUrl(card.imageBase64);
  const downloadedUrl = canLoadCloudImages && download?.key === key ? getCardPhotoUrl(download.base64) : null;
  const imageUrl = (localUrl !== brokenUrl ? localUrl : null) || downloadedUrl;
  const full = variant === 'full';
  const hasPhoto = !!(card.imageBase64 || card.imageDriveId);

  useEffect(() => {
    setError(null);
    if (imageUrl || !card.imageDriveId || !canLoadCloudImages || (!full && !request)) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getImageAsBase64(card.imageDriveId).then(async base64 => {
      // Do not persist a successful HTTP response that the browser cannot display.
      const image = new Image();
      image.src = getCardPhotoUrl(base64)!;
      try { await image.decode(); }
      catch { throw new Error('無法開啟雲端照片，檔案可能不完整。請重試或更換照片。'); }
      if (cancelled) return;
      setDownload({ key, base64 });
      loadedRef.current?.(card, base64);
    }).catch(cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : '照片暫時無法載入，請檢查連線後重試。');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [key, card.imageBase64, imageUrl, card.imageDriveId, canLoadCloudImages, full, request]);

  useEffect(() => { setShowPreview(false); }, [key]);
  useEffect(() => {
    if (!showPreview || !imageUrl) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowPreview(false);
      if (event.key === 'Tab') { event.preventDefault(); closeRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [showPreview, imageUrl]);

  if (!hasPhoto) return null;
  const unavailable = !imageUrl && card.imageDriveId && !canLoadCloudImages
    ? '照片保存在 Google 雲端，請登入儲存這張名片的 Google 帳號後查看。'
    : card.imageBase64 && !imageUrl && !loading && !error && !card.imageDriveId
      ? '無法開啟這張照片，請在編輯名片中更換照片。' : null;
  const message = error || unavailable || (brokenUrl && !imageUrl && !loading ? '照片無法顯示，請重新載入或更換照片。' : null);
  const shortMessage = error?.includes('登入已到期') ? '登入已到期，請重新登入。'
    : error?.includes('存取權') ? '沒有照片存取權。'
    : error?.includes('找不到雲端照片') ? '找不到照片或尚未授權。'
    : error ? '照片載入失敗，請重試。' : card.imageDriveId ? '請登入原本的帳號。' : '請在編輯中更換照片。';
  const failImage = () => {
    setBrokenUrl(imageUrl);
    setDownload(null);
    setShowPreview(false);
  };

  return (
    <div className={full ? 'w-full' : 'w-20 shrink-0'}>
      {imageUrl ? (
        <button type="button" onClick={() => setShowPreview(true)} aria-label="查看名片照片" className={full ? 'block w-full rounded-xl overflow-hidden border border-gray-800 bg-gray-900' : 'block rounded-md border border-gray-600 hover:border-blue-500'}>
          <img src={imageUrl} alt={alt} onError={failImage} className={full ? 'w-full max-h-80 object-contain' : 'w-20 h-14 object-cover rounded-md'} loading={full ? 'eager' : 'lazy'} />
        </button>
      ) : card.imageDriveId && canLoadCloudImages ? (
        <button type="button" onClick={() => { setRequest(count => count + 1); setShowPreview(!full); }} disabled={loading} className={`${full ? 'w-full min-h-24 rounded-xl' : 'w-20 min-h-14 rounded-md'} flex flex-col items-center justify-center gap-1 border border-gray-600 text-gray-300 text-xs disabled:opacity-60`} aria-label={error || brokenUrl ? '重新載入名片照片' : '載入名片照片'}>
          {loading ? <Spinner className="h-5 w-5" /> : <Icon name="camera" className="h-5 w-5" />}
          {loading ? '載入中' : error || brokenUrl ? '重試照片' : '查看照片'}
        </button>
      ) : (
        <div title={message || undefined} aria-label={message || undefined} className={`${full ? 'min-h-24 rounded-xl' : 'min-h-14 rounded-md'} flex flex-col items-center justify-center gap-1 border border-gray-700 text-gray-400 text-xs p-2`}>
          <Icon name="camera" className="h-5 w-5" />{card.imageDriveId ? '登入後查看' : '照片無法顯示'}
        </div>
      )}
      {message && (full || !unavailable || !card.imageDriveId) && <p role="status" aria-label={message} title={message} className="mt-2 text-xs text-amber-200 break-words">{full ? message : shortMessage}</p>}
      {showPreview && imageUrl && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4" onClick={() => setShowPreview(false)} role="dialog" aria-modal="true" aria-label="名片照片預覽">
          <img src={imageUrl} alt={`${card.name || '聯絡人'} 的名片`} className="max-w-[90vw] max-h-[80dvh] object-contain rounded-lg" onError={failImage} onClick={event => event.stopPropagation()} />
          <button type="button" ref={closeRef} onClick={() => setShowPreview(false)} className="absolute top-4 right-4 p-3 text-white rounded-full bg-gray-800" aria-label="關閉預覽"><Icon name="x-mark" className="h-6 w-6" /></button>
        </div>
      )}
    </div>
  );
};

export default CardPhoto;
