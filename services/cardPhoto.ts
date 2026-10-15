import type { BusinessCard } from '../types';

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
    && current.imageDriveId === requested.imageDriveId && current.imageBase64 === requested.imageBase64;
}
