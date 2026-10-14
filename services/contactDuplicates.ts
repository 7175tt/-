import type { BusinessCard } from '../types';
import type { CardStoreState } from './cardStorage';
import { readContactMetadata, uniqueLabels, visibleContacts } from './contactMetadata';

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '').trim();
const emails = (value: string) => [...value.normalize('NFKC').toLocaleLowerCase().matchAll(/[\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[a-z]{2,}/g)].map(match => match[0]);
const phones = (value: string) => value.normalize('NFKC').split(/[\n,;、/|]+/).map(part => {
  const number = part.toLowerCase().replace(/(?:ext\.?|分機|轉|#|x)\s*\d+.*$/, '').replace(/\D/g, '');
  return number.startsWith('886') ? `0${number.slice(3).replace(/^0/, '')}` : number;
}).filter(number => number.length >= 8 && number.length <= 15);
const overlap = (a: string[], b: string[]) => a.some(value => b.includes(value));

export interface DuplicatePair { left: BusinessCard; right: BusinessCard; reasons: string[] }
export function duplicateReasons(a: BusinessCard, b: BusinessCard): string[] {
  if (a.id === b.id || a.cloudAccount !== b.cloudAccount || a.isProcessing || b.isProcessing || a.isError || b.isError) return [];
  const result: string[] = [];
  if (overlap(emails(a.email), emails(b.email))) result.push('Email 相同');
  if (overlap(phones(a.phone), phones(b.phone))) result.push('電話相同（可能共用總機，請確認）');
  if (normalize(a.name) && normalize(a.company) && normalize(a.name) === normalize(b.name) && normalize(a.company) === normalize(b.company)) result.push('姓名與公司相同');
  return result;
}

export function findDuplicatePairs(cards: BusinessCard[]): DuplicatePair[] {
  // Index candidates rather than comparing every pair in a large imported collection.
  const buckets = new Map<string, BusinessCard[]>();
  const result: DuplicatePair[] = [];
  for (const card of visibleContacts(cards).filter(card => !card.isProcessing && !card.isError)) {
    const keys = [...emails(card.email).map(value => `email:${value}`), ...phones(card.phone).map(value => `phone:${value}`),
      ...(normalize(card.name) && normalize(card.company) ? [`name:${normalize(card.name)}:${normalize(card.company)}`] : [])]
      .map(key => JSON.stringify([card.cloudAccount || '', key]));
    const candidates = new Map(keys.flatMap(key => (buckets.get(key) || []).map(other => [other.id, other] as const)));
    for (const other of candidates.values()) {
      const reasons = duplicateReasons(other, card);
      if (reasons.length) result.push({ left: other, right: card, reasons });
      if (result.length >= 200) return result; // Review in batches; recompute after each merge.
    }
    for (const key of new Set(keys)) buckets.set(key, [...(buckets.get(key) || []), card]);
  }
  return result;
}

export const mergeFields = { name: '姓名', company: '公司', title: '職稱', phone: '電話', email: 'Email', address: '地址', notes: '備註' } as const;
export type MergeField = keyof typeof mergeFields;
export type MergeChoices = Partial<Record<MergeField, 'left' | 'right' | 'both'>>;
export const canKeepBoth = (field: MergeField) => ['phone', 'email', 'notes'].includes(field);

function combineEntries<T extends { id: string }>(left: T[] = [], right: T[] = []): T[] {
  const result = new Map(left.map(entry => [entry.id, entry]));
  for (const entry of right) {
    const previous = result.get(entry.id);
    if (!previous) result.set(entry.id, entry);
    else if (JSON.stringify(previous) !== JSON.stringify(entry)) {
      const id = crypto.randomUUID(); result.set(id, { ...entry, id });
    }
  }
  return [...result.values()];
}

/** One atomic local mutation creates the merged card and archives BOTH untouched originals. */
export function mergeContacts(state: CardStoreState, left: BusinessCard, right: BusinessCard, choices: MergeChoices,
  imageBase64?: string, now = Date.now()): { state: CardStoreState; merged: BusinessCard } {
  const activeIds = new Set(visibleContacts(state.cards).map(card => card.id));
  for (const expected of [left, right]) {
    const current = state.cards.find(card => card.id === expected.id);
    if (!current || current.timestamp !== expected.timestamp || current.cloudAccount !== expected.cloudAccount || !activeIds.has(current.id) || current.isProcessing || current.isError) throw new Error('名片已變更，請重新比較後再合併。');
  }
  if (left.id === right.id || left.cloudAccount !== right.cloudAccount) throw new Error('只能合併同一帳號的不同名片。');
  const fields = {} as Pick<BusinessCard, MergeField>;
  for (const field of Object.keys(mergeFields) as MergeField[]) {
    const a = left[field].trim(), b = right[field].trim();
    if (!a || !b || a === b) fields[field] = a || b;
    else {
      const choice = choices[field];
      if (!choice || (choice === 'both' && !canKeepBoth(field))) throw new Error(`請選擇合併後的${mergeFields[field]}。`);
      fields[field] = choice === 'both' ? `${a}\n${b}` : choice === 'left' ? a : b;
    }
  }
  const timestamp = Math.max(now, left.timestamp + 1, right.timestamp + 1);
  const merged: BusinessCard = {
    ...fields, id: crypto.randomUUID(), timestamp, cloudAccount: left.cloudAccount,
    rawText: [...new Set([left.rawText, right.rawText].filter(Boolean))].join('\n\n'),
    ...(imageBase64 ? { imageBase64 } : {}), needsReview: !!(left.needsReview || right.needsReview),
    ...readContactMetadata({ tags: uniqueLabels([...(left.tags || []), ...(right.tags || [])]),
      events: uniqueLabels([...(left.events || []), ...(right.events || [])]),
      followUps: combineEntries(left.followUps, right.followUps), interactions: combineEntries(left.interactions, right.interactions) }),
  };
  if ([...Object.values(fields), merged.rawText].some(value => value.length > 50_000)) throw new Error('合併後的文字超過單一欄位可保存的長度，原始名片仍保留，請先整理內容。');
  for (const original of [left, right]) readContactMetadata({ ...original, mergedIntoId: merged.id });
  const ids = new Set([left.id, right.id]);
  return { merged, state: { ...state, cards: [merged, ...state.cards.map(card => ids.has(card.id) ? { ...card, mergedIntoId: merged.id, timestamp } : card)] } };
}
