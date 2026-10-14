import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusinessCard } from '../types';
import { matchesCard } from '../services/cardSearch';

const card: BusinessCard = {
  id: 'contact', name: 'José 王小明', company: 'ＡＣＭＥ　科技', title: 'Product Manager',
  phone: '（０２）１２３４－５６７８ / 0912-345-678 ext. 99', email: 'Jose@example.com',
  address: '台北市 信義路', notes: '在台中展覽認識，想了解採購方案', rawText: '品牌名稱：星河設計', timestamp: 0,
};

test('search normalizes compatibility characters, accents, case, and whitespace', () => {
  assert.equal(matchesCard(card, '  JOSE　 Acme\tMANAGER '), true);
  assert.equal(matchesCard(card, '王小明 科技'), true);
  assert.equal(matchesCard(card, 'jose acme missing'), false);
});

test('every term can match a different field including notes and recognized text', () => {
  assert.equal(matchesCard(card, '王小明 台中 星河 example.com'), true);
  assert.equal(matchesCard(card, '星河', 'rawText'), true);
  assert.equal(matchesCard(card, '台中', 'notes'), true);
  assert.equal(matchesCard(card, '台中', 'address'), false);
  assert.equal(matchesCard(card, 'jose acme', 'name'), false);
  assert.equal(matchesCard(card, '  \n\t '), true);
});

test('telephone searches ignore formatting and fullwidth digits', () => {
  assert.equal(matchesCard(card, '０２１２３４５６７８'), true);
  assert.equal(matchesCard(card, '0912345678', 'phone'), true);
  assert.equal(matchesCard(card, '(02)1234-5678'), true);
  assert.equal(matchesCard(card, '王小明 0912–345–678'), true);
  assert.equal(matchesCard(card, '0912345678', 'name'), false);
});

test('telephone normalization cannot join separate numbers or extensions', () => {
  assert.equal(matchesCard(card, '56780912'), false);
  assert.equal(matchesCard(card, '567899'), false);
  for (const separator of [', ', '; ', '\n', ' / ', ' | ', '、', ' +']) {
    const separated = { ...card, phone: `123-456${separator}789-012` };
    assert.equal(matchesCard(separated, '456789', 'phone'), false, `separator ${JSON.stringify(separator)}`);
    assert.equal(matchesCard(separated, '789012', 'phone'), true);
  }
});
