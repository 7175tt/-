import type { BusinessCard } from '../types';
import { pendingFollowUps } from './contactMetadata';

const searchableFields = ['name', 'company', 'title', 'phone', 'email', 'address', 'notes', 'rawText'] as const;

const normalizeText = (value: string): string => value
  .normalize('NFKC')
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

/** Keep numbers separate so a search never bridges a telephone and another number. */
const phoneNumbers = (value: string): string[] => {
  const normalized = value.normalize('NFKC').replace(/[‐‑‒–—−]/g, '-');
  return normalized.split(/[\r\n,;、/|]+/).flatMap(part => {
    const candidates = part.match(/\+?[\d(][\d(). \t-]*/g) || [];
    return candidates.map(candidate => candidate.replace(/\D/g, ''))
      .filter(number => number.length > 0 && number.length <= 15);
  });
};

/** Every search term must match, but terms may match different fields. */
export const matchesCard = (card: BusinessCard, query: string, category = 'all'): boolean => {
  const terms = normalizeText(query).split(' ').filter(Boolean);
  if (terms.length === 0) return true;

  const fields = searchableFields.includes(category as typeof searchableFields[number])
    ? [category as typeof searchableFields[number]]
    : searchableFields;
  const values = fields.map(field => normalizeText(card[field] || ''));
  if (category === 'all') values.push(...[
    ...(card.tags || []), ...(card.events || []), ...pendingFollowUps(card).map(task => task.text),
    ...(card.interactions || []).map(entry => entry.text),
  ].map(normalizeText));
  const numbers = fields.includes('phone') ? phoneNumbers(card.phone || '') : [];

  return terms.every(term => {
    if (values.some(value => value.includes(term))) return true;
    const phoneTerm = term.replace(/[‐‑‒–—−]/g, '-');
    if (!/^[+\d().-]+$/.test(phoneTerm)) return false;
    const digits = phoneTerm.replace(/\D/g, '');
    return digits.length > 0 && numbers.some(number => number.includes(digits));
  });
};
