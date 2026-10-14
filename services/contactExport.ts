import type { BusinessCard } from '../types';

const phoneLabel = /^(?:tel(?:ephone)?|phone|mobile|cell|office|work|[tm]|電話|手機|行動電話|公司電話|市話|聯絡電話)\s*:?\s*/i;

/** Use one number and an explicit extension, never concatenate several numbers. */
export const getPhoneHref = (phone?: string): string | undefined => {
  if (!phone) return undefined;
  const value = phone.normalize('NFKC').replace(/[‐‑‒–—−]/g, '-').trim().replace(phoneLabel, '');
  const match = value.match(/^(\+?[\d(][\d(). \t-]*)(?:\s*(?:;ext=|ext(?:ension)?\.?|x|#|分機|轉)\s*[:.=]?\s*(\d+))?/i);
  if (!match) return undefined;
  const remainder = value.slice(match[0].length);
  if (remainder && !/^(?:\s*[,;/|\r\n、]|\s+\+|\s+(?:or|或)\s+)/i.test(remainder)) return undefined;
  const number = match[1].replace(/[(). \t-]/g, '');
  if (!/^\+?\d{3,15}$/.test(number) || (match[2] && match[2].length > 10)) return undefined;
  return `tel:${number}${match[2] ? `;ext=${match[2]}` : ''}`;
};

const firstEmail = (value?: string): string | undefined => {
  if (!value) return undefined;
  const normalized = value.normalize('NFKC').trim();
  // Header parameters must never be accepted as part of a contact address.
  if (/[\u0000-\u001f\u007f]|%0[ad]/i.test(normalized)) return undefined;
  const first = normalized.split(/[,;]/)[0].trim().replace(/^(?:mailto:|e-?mail\s*:)\s*/i, '');
  const displayAddress = first.match(/^[^<>]*<([^<>]+)>$/);
  const address = displayAddress ? displayAddress[1].trim() : first.split(/\s+/)[0];
  const parts = address.split('@');
  if (parts.length !== 2) return undefined;
  const [local, domain] = parts;
  if (!/^[^\s<>@,;:()[\]\\"]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return undefined;
  if (!/^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?)+$/u.test(domain)) return undefined;
  return address;
};

export const getEmailHref = (email?: string): string | undefined => {
  const address = firstEmail(email);
  return address ? `mailto:${encodeURIComponent(address).replace(/%40/g, '@')}` : undefined;
};

export const getAddressHref = (address?: string): string | undefined => {
  const query = address?.trim().replace(/\s+/g, ' ');
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : undefined;
};

const escapeText = (value: string): string => value
  .replace(/\\/g, '\\\\')
  .replace(/\r\n|\r|\n/g, '\\n')
  .replace(/;/g, '\\;')
  .replace(/,/g, '\\,')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

const encoder = new TextEncoder();

/** vCard folds at 75 UTF-8 octets, including the continuation space. */
const foldLine = (line: string): string => {
  let result = '';
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      result += '\r\n ';
      bytes = 1;
    }
    result += character;
    bytes += size;
  }
  return result;
};

/** Export ready contacts in the format supported by mobile address books. */
export const cardsToVCard = (cards: BusinessCard[]): string => {
  const contacts = cards.filter(card => !card.isProcessing && !card.isError).map(card => {
    const name = card.name?.trim() || card.company?.trim() || '未命名聯絡人';
    // There is only one name field; preserve it instead of guessing family/given names.
    const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${escapeText(name)};;;;`, `FN:${escapeText(name)}`];
    if (card.company) lines.push(`ORG:${escapeText(card.company)}`);
    if (card.title) lines.push(`TITLE:${escapeText(card.title)}`);
    const phones = (card.phone || '').split(/[\r\n,/|、]|;(?!\s*ext=)/i).map(getPhoneHref).filter(Boolean);
    for (const phone of new Set(phones)) {
      lines.push(`TEL;TYPE=WORK,VOICE:${escapeText(phone!.slice(4).replace(';ext=', ' x'))}`);
    }
    const emails = /[\r\n]|%0[ad]/i.test(card.email || '') ? [] : (card.email || '').split(/[,;]/).map(firstEmail).filter(Boolean);
    for (const email of new Set(emails)) lines.push(`EMAIL;TYPE=INTERNET:${escapeText(email!)}`);
    if (card.address) lines.push(`ADR;TYPE=WORK:;;${escapeText(card.address)};;;;`);
    if (card.notes) lines.push(`NOTE:${escapeText(card.notes)}`);
    if (card.id) lines.push(`UID:${escapeText(card.id)}`);
    lines.push('END:VCARD');
    return lines.map(foldLine).join('\r\n');
  });
  return contacts.length ? `${contacts.join('\r\n')}\r\n` : '';
};

export const downloadVCard = (cards: BusinessCard[]): void => {
  const contents = cardsToVCard(cards);
  if (!contents) return;
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/vcard;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `business_cards_${new Date().toISOString().slice(0, 10)}.vcf`;
  link.style.display = 'none';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Allow mobile browsers to consume the download before releasing its URL.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
};
