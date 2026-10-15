import assert from 'node:assert/strict';
import test from 'node:test';
import { getCardPhotoUrl, isSameCardPhoto } from '../services/cardPhoto';
import type { BusinessCard } from '../types';

test('local JPEGs and older complete image data URLs have a single image prefix', () => {
  assert.equal(getCardPhotoUrl('/9j/4AAQ'), 'data:image/jpeg;base64,/9j/4AAQ');
  assert.equal(getCardPhotoUrl(' data:image/jpeg;base64,/9j/4AAQ '), 'data:image/jpeg;base64,/9j/4AAQ');
  assert.equal(getCardPhotoUrl('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(getCardPhotoUrl('data:text/html;base64,PHNjcmlwdD4='), null);
  assert.equal(getCardPhotoUrl('data:image/svg+xml;base64,PHN2Zz4='), null);
  assert.equal(getCardPhotoUrl(''), null);
  assert.equal(getCardPhotoUrl(), null);
});

test('late photo downloads cannot attach to replaced, removed, or differently owned photos', () => {
  const requested = { id: 'card', cloudAccount: 'owner@example.invalid', imageDriveId: 'photo' } as BusinessCard;
  assert.equal(isSameCardPhoto({ ...requested, name: 'Edited text' }, requested), true);
  for (const change of [
    { id: 'another-card' }, { cloudAccount: 'other@example.invalid' },
    { imageDriveId: 'replacement' }, { imageDriveId: undefined },
    { imageBase64: 'replacement-photo' },
  ]) assert.equal(isSameCardPhoto({ ...requested, ...change }, requested), false);
});
