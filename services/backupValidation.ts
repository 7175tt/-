import type { BusinessCard } from '../types';
import { readContactMetadata } from './contactMetadata';

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
export const MAX_IMPORT_CARDS = 5000;
const MAX_TEXT_LENGTH = 50_000;
const TEXT_FIELDS = ['name', 'company', 'title', 'phone', 'email', 'address', 'notes', 'rawText'] as const;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Validate the entire backup before returning anything that could replace user data. */
export function parseCardBackup(text: string, now = Date.now()): BusinessCard[] {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) {
    throw new Error('備份檔案超過 50 MB，請使用較小的備份檔。');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('無法讀取 JSON 備份，請確認檔案完整且格式正確。');
  }
  // Original versions exported a plain array. Also support explicitly versioned backups.
  const entries = Array.isArray(parsed) ? parsed
    : record(parsed) && parsed.version === 1 && Array.isArray(parsed.cards) ? parsed.cards : null;
  if (!entries) throw new Error('備份格式不正確，請選擇由名片管家匯出的 JSON 檔案。');
  if (entries.length === 0) throw new Error('備份檔案沒有名片，現有資料不會變更。');
  if (entries.length > MAX_IMPORT_CARDS) throw new Error('一次最多可匯入 5,000 張名片，請分批匯入。');

  const seenIds = new Set<string>();
  return entries.map((entry, index) => {
    const fail = (message: string): never => { throw new Error(`第 ${index + 1} 張名片${message}，尚未匯入任何資料。`); };
    if (!record(entry)) return fail('格式不正確');
    const fields = {} as Pick<BusinessCard, typeof TEXT_FIELDS[number]>;
    for (const field of TEXT_FIELDS) {
      const value = entry[field];
      if (value !== undefined && typeof value !== 'string') return fail(`的 ${field} 欄位必須是文字`);
      if (typeof value === 'string' && value.length > MAX_TEXT_LENGTH) return fail('的文字內容過長');
      fields[field] = value as string | undefined ?? '';
    }
    if (entry.id !== undefined && (typeof entry.id !== 'string' || !entry.id.trim() || entry.id.length > 200)) {
      return fail('的識別碼不正確');
    }
    const id = typeof entry.id === 'string' ? entry.id : crypto.randomUUID();
    if (seenIds.has(id)) return fail('的識別碼重複');
    seenIds.add(id);

    if (entry.timestamp !== undefined && (typeof entry.timestamp !== 'number' || !Number.isFinite(entry.timestamp) || entry.timestamp < 0 || entry.timestamp > 8.64e15)) {
      return fail('的建立時間不正確');
    }
    for (const flag of ['isError', 'isProcessing', 'needsReview']) {
      if (entry[flag] !== undefined && typeof entry[flag] !== 'boolean') return fail(`的 ${flag} 欄位不正確`);
    }
    if (entry.errorMessage !== undefined && (typeof entry.errorMessage !== 'string' || entry.errorMessage.length > MAX_TEXT_LENGTH)) {
      return fail('的錯誤訊息格式不正確');
    }
    if (entry.imageBase64 !== undefined && (typeof entry.imageBase64 !== 'string' || entry.imageBase64.length > 12 * 1024 * 1024 || entry.imageBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(entry.imageBase64))) {
      return fail('的照片格式不正確或超過 9 MB');
    }
    if (entry.imageDriveId !== undefined && (typeof entry.imageDriveId !== 'string' || !/^[\w-]{1,200}$/.test(entry.imageDriveId))) {
      return fail('的雲端照片識別碼不正確');
    }
    if (!TEXT_FIELDS.some(field => fields[field].trim()) && !entry.imageBase64 && !entry.imageDriveId) {
      return fail('沒有任何聯絡資訊或照片');
    }
    // Never revive an interrupted request as a permanent loading indicator.
    const interrupted = entry.isProcessing === true;
    return {
      ...readContactMetadata(entry),
      ...fields, id, timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : now,
      ...(entry.imageBase64 ? { imageBase64: entry.imageBase64 as string } : {}),
      ...(entry.imageDriveId ? { imageDriveId: entry.imageDriveId as string } : {}),
      ...(entry.needsReview === true ? { needsReview: true } : {}),
      ...(entry.isError === true || interrupted ? { isError: true } : {}),
      ...(interrupted ? { errorMessage: '上次辨識尚未完成，請重新辨識或手動填寫。' }
        : typeof entry.errorMessage === 'string' ? { errorMessage: entry.errorMessage } : {}),
    };
  });
}
