import type { BusinessCard } from '../types';
import { loadStoredCardPhoto } from './cardStorage';

export const hasCardPhoto = (card: BusinessCard) => !!(card.imageBase64 || card.imageLocalId || card.imageDriveId);
let preparing = 0;
const waiting: Array<() => void> = [];
export function withPhotoBudget<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let started = false;
    let cancelRunning: ((reason: unknown) => void) | undefined;
    const aborted = () => {
      const error = new DOMException('照片載入已取消。', 'AbortError');
      if (!started) { const index = waiting.indexOf(start); if (index >= 0) waiting.splice(index, 1); reject(error); }
      else cancelRunning?.(error);
    };
    const start = () => {
      started = true;
      preparing++;
      const cancelled = new Promise<never>((_resolve, fail) => { cancelRunning = fail; });
      Promise.race([operation(), cancelled]).then(resolve, reject).finally(() => {
        signal?.removeEventListener('abort', aborted);
        preparing--; waiting.shift()?.();
      });
    };
    if (signal?.aborted) { reject(new DOMException('照片載入已取消。', 'AbortError')); return; }
    signal?.addEventListener('abort', aborted, { once: true });
    if (preparing < 2) start(); else waiting.push(start);
  });
}
export async function resolveCardPhoto(card: BusinessCard): Promise<string | undefined> {
  return card.imageBase64 || (card.imageLocalId ? await loadStoredCardPhoto(card.imageLocalId) : undefined);
}

/** Keep decoded list images small; original pixels are read only for editing/zoom. */
export async function makeCardThumbnail(base64: string): Promise<string> {
  const image = new Image();
  image.src = getCardPhotoUrl(base64)!;
  try {
    await image.decode();
    const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('無法建立照片縮圖。');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } finally { image.removeAttribute('src'); }
}

/** Older local snapshots can contain a complete data URL instead of bare base64. */
export function getCardPhotoUrl(image?: string): string | null {
  const value = image?.trim();
  if (!value) return null;
  if (/^data:image\/(?:jpeg|jpg|png|webp|gif|avif|heic|heif|bmp);base64,/i.test(value)) return value;
  if (/^data:/i.test(value)) return null;
  return `data:image/jpeg;base64,${value}`;
}

/** A late download must not replace a newer photo or a different account's photo. */
export function isSameCardPhoto(current: BusinessCard, requested: BusinessCard): boolean {
  return current.id === requested.id && current.cloudAccount === requested.cloudAccount
    && current.imageDriveId === requested.imageDriveId && current.imageBase64 === requested.imageBase64
    && current.imageLocalId === requested.imageLocalId;
}
