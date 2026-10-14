import type { BusinessCard, ContactMetadata, FollowUp } from '../types';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const isCalendarDate = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' && value <= '9998-12-31'
  && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;

export const uniqueLabels = (values: string[]) => [...new Map(values.map(value => value.normalize('NFKC').trim()).filter(Boolean)
  .map(value => [value.toLocaleLowerCase(), value])).values()];
export const parseLabels = (value: string) => uniqueLabels(value.split(/[,，、\n]+/));

/** Reject malformed/newer data rather than silently dropping a user's contact history. */
export function readContactMetadata(value: unknown): ContactMetadata {
  if (!object(value)) throw new Error('人脈資料格式不正確。');
  if (value.version !== undefined && value.version !== 1) throw new Error('人脈資料版本較新，請先更新名片管家。');
  const result: ContactMetadata = {};
  for (const field of ['tags', 'events'] as const) {
    if (value[field] === undefined) continue;
    if (!Array.isArray(value[field]) || value[field].length > 50 || value[field].some(item => !text(item, 80))) throw new Error('標籤與場合各最多 50 個，每個最多 80 字。');
    result[field] = uniqueLabels(value[field] as string[]);
  }
  for (const field of ['followUps', 'interactions'] as const) {
    const entries = value[field];
    if (entries === undefined) continue;
    if (!Array.isArray(entries) || entries.length > 200) throw new Error('每張名片的待辦與互動紀錄各最多 200 筆，請先備份整理。');
    const ids = new Set<string>();
    const validated = entries.map(entry => {
      if (!object(entry) || !text(entry.id, 200) || ids.has(entry.id) || !text(entry.text, 2000) || !validTime(entry.createdAt)) throw new Error('待辦或互動紀錄格式不正確，內容最多 2,000 字。');
      ids.add(entry.id);
      const common = { id: entry.id, text: entry.text, createdAt: entry.createdAt };
      if (field === 'interactions') {
        if (!isCalendarDate(entry.occurredOn)) throw new Error('互動日期不正確。');
        return { ...common, occurredOn: entry.occurredOn };
      }
      if (!isCalendarDate(entry.dueDate) || (entry.completedAt !== undefined && !validTime(entry.completedAt))) throw new Error('待辦日期不正確。');
      return { ...common, dueDate: entry.dueDate, ...(entry.completedAt !== undefined ? { completedAt: entry.completedAt as number } : {}) };
    });
    Object.assign(result, { [field]: validated });
  }
  if (value.mergedIntoId !== undefined) {
    if (!text(value.mergedIntoId, 200)) throw new Error('合併來源格式不正確。');
    result.mergedIntoId = value.mergedIntoId;
  }
  // A Sheets cell supports 50,000 characters; leave room for future schema fields.
  if (JSON.stringify(result).length > 45_000) throw new Error('這張名片的人脈紀錄過長，請先備份並整理後再儲存。');
  return result;
}

export function encodeContactMetadata(card: ContactMetadata): string {
  const data = readContactMetadata(card);
  return Object.keys(data).length ? JSON.stringify({ version: 1, ...data }) : '';
}

export function decodeContactMetadata(value: unknown): ContactMetadata {
  if (value === '' || value === undefined || value === null) return {};
  if (typeof value !== 'string') throw new Error('人脈資料欄必須是 JSON 文字。');
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('人脈資料無法讀取，請檢查試算表或備份中的 JSON 格式。'); }
  return readContactMetadata(parsed);
}

export const pendingFollowUps = (card: BusinessCard) => (card.followUps || []).filter(task => task.completedAt === undefined)
  .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt - b.createdAt);

export function calendarLink(card: BusinessCard, task: FollowUp): string {
  const end = new Date(`${task.dueDate}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const params = new URLSearchParams({ action: 'TEMPLATE', text: `${task.text}｜${card.name || card.company || '聯絡人'}`,
    dates: `${task.dueDate.replaceAll('-', '')}/${end.toISOString().slice(0, 10).replaceAll('-', '')}`,
    details: [card.company, card.phone, card.email].filter(Boolean).join('\n') });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** Orphaned/cyclic archive links stay visible so imports cannot hide contacts forever. */
export function visibleContacts(cards: BusinessCard[]): BusinessCard[] {
  const byId = new Map(cards.map(card => [card.id, card]));
  return cards.filter(card => {
    let current = card;
    const seen = new Set([card.id]);
    while (current.mergedIntoId) {
      const parent = byId.get(current.mergedIntoId);
      if (!parent || parent.cloudAccount !== card.cloudAccount || seen.has(parent.id)) return true;
      seen.add(parent.id);
      current = parent;
    }
    return current.id === card.id;
  });
}

export function mergeSources(cards: BusinessCard[], id: string): BusinessCard[] {
  const ids = new Set([id]);
  const owner = cards.find(card => card.id === id)?.cloudAccount;
  const result: BusinessCard[] = [];
  for (let previous = -1; previous !== ids.size;) {
    previous = ids.size;
    for (const card of cards) if (card.cloudAccount === owner && card.mergedIntoId && ids.has(card.mergedIntoId) && !ids.has(card.id)) {
      ids.add(card.id); result.push(card);
    }
  }
  return result;
}
