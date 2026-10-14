import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusinessCard } from '../types';
import { cardsToVCard, getAddressHref, getEmailHref, getPhoneHref } from '../services/contactExport';

const card: BusinessCard = {
  id: 'contact-1', name: '王小明', company: '星河設計', title: '設計師',
  phone: '+886 (2) 1234-5678 分機 12 / 0912-345-678', email: 'hello@example.com; second@example.com',
  address: '台北市\n信義區', notes: '展覽認識', rawText: '', timestamp: 0,
};

test('vCard preserves Unicode names and reusable contact fields', () => {
  const result = cardsToVCard([card]);
  assert.ok(result.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n'));
  assert.ok(result.includes('N:王小明;;;;\r\nFN:王小明\r\n'));
  assert.ok(result.includes('TEL;TYPE=WORK,VOICE:+886212345678 x12\r\n'));
  assert.ok(result.includes('TEL;TYPE=WORK,VOICE:0912345678\r\n'));
  assert.ok(result.includes('EMAIL;TYPE=INTERNET:hello@example.com\r\n'));
  assert.ok(result.includes('EMAIL;TYPE=INTERNET:second@example.com\r\n'));
  assert.ok(result.includes('ADR;TYPE=WORK:;;台北市\\n信義區;;;;\r\n'));
  assert.ok(result.endsWith('END:VCARD\r\n'));
});

test('vCard escapes literal punctuation and prevents property injection', () => {
  const result = cardsToVCard([{ ...card, name: 'Doe, Jane;別名', company: 'A\\B;C,D', notes: 'Line 1\r\nEND:VCARD\nBEGIN:VCARD\rLine 4' }]);
  assert.ok(result.includes('FN:Doe\\, Jane\\;別名\r\n'));
  assert.ok(result.includes('ORG:A\\\\B\\;C\\,D\r\n'));
  assert.ok(result.includes('NOTE:Line 1\\nEND:VCARD\\nBEGIN:VCARD\\nLine 4\r\n'));
  assert.equal(result.split('\r\n').filter(line => line === 'BEGIN:VCARD').length, 1);
  assert.equal(result.split('\r\n').filter(line => line === 'END:VCARD').length, 1);
  assert.equal(result.replace(/\r\n/g, '').includes('\n'), false);
});

test('folded lines stay within 75 UTF-8 bytes without splitting Unicode characters', () => {
  const name = '王小明🌏'.repeat(24);
  const result = cardsToVCard([{ ...card, name, notes: 'é台灣🚀'.repeat(40) }]);
  for (const line of result.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
    assert.equal(Buffer.from(line, 'utf8').toString('utf8'), line);
    assert.equal(line.includes('\ufffd'), false);
  }
  const unfolded = result.replace(/\r\n /g, '');
  assert.ok(unfolded.includes(`FN:${name}\r\n`));
  assert.ok(unfolded.includes(`N:${name};;;;\r\n`));
});

test('only ready contacts are exported and unnamed contacts get a useful name', () => {
  const result = cardsToVCard([card, { ...card, id: 'pending', isProcessing: true }, { ...card, id: 'failed', isError: true }]);
  assert.equal(result.split('BEGIN:VCARD').length - 1, 1);
  assert.equal(cardsToVCard([{ ...card, isProcessing: true }]), '');
  assert.equal(cardsToVCard([]), '');
  assert.ok(cardsToVCard([{ ...card, name: '' }]).includes('FN:星河設計\r\n'));
});

test('telephone links normalize the first number and retain extensions', () => {
  assert.equal(getPhoneHref(card.phone), 'tel:+886212345678;ext=12');
  assert.equal(getPhoneHref('電話：（０２）１２３４－５６７８ # ９９'), 'tel:0212345678;ext=99');
  assert.equal(getPhoneHref('0912 345 678, 0987 654 321'), 'tel:0912345678');
  assert.equal(getPhoneHref('02-1234-5678;ext=123'), 'tel:0212345678;ext=123');
  for (const value of ['', 'javascript:alert(123)', '123?body=hello', '+12+345', '123456789012345678', '*123#']) {
    assert.equal(getPhoneHref(value), undefined, value);
  }
});

test('email links choose the first address and safely encode literal characters', () => {
  assert.equal(getEmailHref('Jane <jane+work@example.com>; second@example.com'), 'mailto:jane%2Bwork@example.com');
  assert.equal(getEmailHref('first@example.com second@example.com'), 'mailto:first@example.com');
  assert.equal(getEmailHref('user@example.com?subject=Injected'), undefined);
  for (const value of ['', 'not an email', 'a@example.com\r\nBcc:other@example.com', 'a@example.com%0d%0aBcc:other@example.com', 'a@exa mple.com', 'a@javascript:alert(1)']) {
    assert.equal(getEmailHref(value), undefined, value);
  }
});

test('map links contain only an encoded search query', () => {
  const address = '台北市\n信義區 &query=other#fragment';
  const url = new URL(getAddressHref(address)!);
  assert.equal(url.origin, 'https://www.google.com');
  assert.equal(url.searchParams.get('query'), '台北市 信義區 &query=other#fragment');
  assert.equal(url.searchParams.getAll('query').length, 1);
  assert.equal(url.hash, '');
  assert.equal(getAddressHref('  '), undefined);
});
