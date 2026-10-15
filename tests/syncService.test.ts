import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BusinessCard } from '../types';
import type { CardStoreState } from '../services/cardStorage';
import { applySyncResult, synchronizeCards, type CloudApi, type SyncResult } from '../services/syncService';

const ACCOUNT = 'owner@example.com';
const OTHER = 'other@example.com';
const card = (id: string, overrides: Partial<BusinessCard> = {}): BusinessCard => ({
  id, name: id, company: '', title: '', phone: '', email: '', address: '', notes: '', rawText: '', timestamp: 100,
  ...overrides,
});
const state = (cards: BusinessCard[], deletions: CardStoreState['deletions'] = []): CardStoreState => ({ cards, deletions });
const result = (cards: BusinessCard[], deleted: string[] = [], removed: string[] = []): SyncResult => ({ cards, deleted, removed, spreadsheetId: 'sheet' });
function cloud(remote: BusinessCard[] = []) {
  const calls: Array<{ action: string; id?: string; card?: BusinessCard }> = [];
  const api: CloudApi = {
    getCloudCardsLight: async () => { calls.push({ action: 'read' }); return { cards: remote, spreadsheetId: 'sheet' }; },
    updateCardInSheet: async card => { calls.push({ action: 'write', id: card.id, card }); },
    uploadImageToDrive: async (_image, id) => { calls.push({ action: 'image', id }); return `drive-${id}`; },
    deleteCardFromSheet: async id => { calls.push({ action: 'delete', id }); },
  };
  return { api, calls };
}

test('editing a name directly in Sheets updates the app without changing the timestamp column', async () => {
  const local = card('sheet-edit', { name: '郭 芃 宏', cloudAccount: ACCOUNT, lastSyncedAt: 100, lastSyncedSheetId: 'sheet', imageDriveId: 'photo', imageBase64: 'cached-photo', needsReview: true });
  const { api, calls } = cloud([card('sheet-edit', { name: '郭芃宏', title: '更新職稱', imageDriveId: 'photo' })]);
  const before = state([local]);
  const synced = await synchronizeCards(before, ACCOUNT, api);
  const after = applySyncResult(before, before, synced, ACCOUNT);
  assert.equal(after.cards[0].name, '郭芃宏');
  assert.equal(after.cards[0].title, '更新職稱');
  assert.equal(after.cards[0].imageBase64, 'cached-photo');
  assert.equal(after.cards[0].needsReview, true);
  assert.deepEqual(calls.map(call => call.action), ['read'], 'Reading a Sheet correction must not write the old text back');
  assert.equal(applySyncResult(after, after, await synchronizeCards(after, ACCOUNT, api), ACCOUNT), after, 'Repeated reads must settle');
});

test('Sheet photo replacements invalidate the old cache even with an unchanged timestamp', async () => {
  const before = state([card('photo-edit', { cloudAccount: ACCOUNT, imageDriveId: 'old-photo', imageBase64: 'old-cache', lastSyncedAt: 100, lastSyncedSheetId: 'sheet' })]);
  const { api } = cloud([card('photo-edit', { imageDriveId: 'new-photo' })]);
  const after = applySyncResult(before, before, await synchronizeCards(before, ACCOUNT, api), ACCOUNT);
  assert.equal(after.cards[0].imageDriveId, 'new-photo');
  assert.equal(after.cards[0].imageBase64, undefined);
});

test('unsent local edits still upload while unchanged contacts accept Sheet corrections', async () => {
  const before = state([
    card('pending', { name: 'Local edit', timestamp: 200, lastSyncedAt: 100, lastSyncedSheetId: 'sheet', cloudAccount: ACCOUNT }),
    card('sheet-only', { name: 'Original', timestamp: 100, lastSyncedAt: 100, lastSyncedSheetId: 'sheet', cloudAccount: ACCOUNT }),
  ]);
  const { api, calls } = cloud([card('pending'), card('sheet-only', { name: 'Sheet correction' })]);
  const after = applySyncResult(before, before, await synchronizeCards(before, ACCOUNT, api), ACCOUNT);
  assert.equal(after.cards.find(card => card.id === 'pending')?.name, 'Local edit');
  assert.equal(after.cards.find(card => card.id === 'sheet-only')?.name, 'Sheet correction');
  assert.deepEqual(calls.filter(call => call.action === 'write').map(call => call.id), ['pending']);
});

test('sync applies remote additions without overwriting edits made during the request', () => {
  const original = card('edited', { cloudAccount: ACCOUNT });
  const snapshot = state([original]);
  const edited = { ...original, name: 'User edit during sync', timestamp: 200 };
  const current = state([edited]);
  const next = applySyncResult(current, snapshot, result([
    { ...original, name: 'Stale snapshot', cloudAccount: ACCOUNT },
    card('remote-added', { cloudAccount: ACCOUNT }),
  ]), ACCOUNT);
  assert.equal(next.cards.find(c => c.id === 'edited'), edited);
  assert.equal(next.cards.find(c => c.id === 'remote-added')?.cloudAccount, ACCOUNT);
});

test('cards deleted during a sync cannot be resurrected by the downloaded snapshot', () => {
  const snapshot = state([card('removed', { cloudAccount: ACCOUNT })]);
  const deletion = { id: 'removed', account: ACCOUNT, deletedAt: 200 };
  const current = state([], [deletion]);
  const next = applySyncResult(current, snapshot, result([card('removed', { cloudAccount: ACCOUNT })]), ACCOUNT);
  assert.deepEqual(next.cards, []);
  assert.deepEqual(next.deletions, [deletion]);
});

test('a local-only removal during sync is preserved even without a cloud tombstone', () => {
  const snapshot = state([card('removed')]);
  const current = state([]);
  assert.deepEqual(applySyncResult(current, snapshot, result([card('removed')]), ACCOUNT).cards, []);
});

test('newly created local cards and in-progress scans survive a remote ID collision', () => {
  const processing = card('scan', { isProcessing: true, timestamp: 200 });
  const failed = card('failed', { isError: true, errorMessage: 'Photo saved', timestamp: 200 });
  const added = card('new', { name: 'Local new card' });
  const snapshot = state([processing, failed]);
  const current = state([processing, failed, added]);
  const next = applySyncResult(current, snapshot, result([card('scan'), card('failed'), card('new')]), ACCOUNT);
  assert.equal(next.cards.find(c => c.id === 'scan'), processing);
  assert.equal(next.cards.find(c => c.id === 'failed'), failed);
  assert.equal(next.cards.find(c => c.id === 'new'), added);
});

test('sync reads and writes only the current account and unbound cards', async () => {
  const { api, calls } = cloud();
  const other = card('other', { cloudAccount: OTHER, imageDriveId: 'other-private-photo' });
  const snapshot = state([other, card('mine', { cloudAccount: ACCOUNT }), card('unbound')], [
    { id: 'delete-mine', account: ACCOUNT, deletedAt: 100 },
    { id: 'delete-other', account: OTHER, deletedAt: 100 },
  ]);
  const synced = await synchronizeCards(snapshot, ACCOUNT, api);
  assert.deepEqual(calls.filter(c => c.action === 'write').map(c => c.id), ['mine', 'unbound']);
  assert.deepEqual(calls.filter(c => c.action === 'delete').map(c => c.id), ['delete-mine']);
  assert.ok(synced.cards.every(c => c.cloudAccount === ACCOUNT));
  const applied = applySyncResult(snapshot, snapshot, synced, ACCOUNT);
  assert.equal(applied.cards.find(c => c.id === 'other'), other);
  assert.deepEqual(applied.deletions, [{ id: 'delete-other', account: OTHER, deletedAt: 100 }]);
});

test('a downloaded card cannot replace a different account with the same local ID', () => {
  const other = card('shared-id', { cloudAccount: OTHER, name: 'Private other account' });
  const current = state([other]);
  const next = applySyncResult(current, current, result([card('shared-id', { cloudAccount: ACCOUNT })]), ACCOUNT);
  assert.equal(next.cards[0], other);
});

test('unbound/imported Drive IDs are not reused across accounts', async () => {
  const { api, calls } = cloud();
  const imported = card('imported', { imageDriveId: 'foreign-drive-id', imageBase64: 'YQ==' });
  const noPhoto = card('no-photo', { imageDriveId: 'another-foreign-id' });
  const synced = await synchronizeCards(state([imported, noPhoto]), ACCOUNT, api);
  assert.equal(synced.cards.find(c => c.id === 'imported')?.imageDriveId, 'drive-imported');
  assert.equal(synced.cards.find(c => c.id === 'no-photo')?.imageDriveId, undefined);
  assert.deepEqual(calls.filter(c => c.action === 'image').map(c => c.id), ['imported']);
  assert.equal(imported.imageDriveId, 'foreign-drive-id', 'The input snapshot must not be mutated');
});

test('incomplete and failed scans are never uploaded, including when a remote copy exists', async () => {
  const { api, calls } = cloud([card('processing'), card('failed')]);
  const snapshot = state([card('processing', { isProcessing: true }), card('failed', { isError: true })]);
  const synced = await synchronizeCards(snapshot, ACCOUNT, api);
  assert.deepEqual(synced.cards, []);
  assert.deepEqual(calls, [{ action: 'read' }]);
  assert.equal(applySyncResult(snapshot, snapshot, synced, ACCOUNT), snapshot);
});

test('newer cloud changes win while cached photos remain only for the same Drive file', async () => {
  const remote = [card('same-image', { name: 'Cloud edit', imageDriveId: 'same', timestamp: 300 }), card('new-image', { imageDriveId: 'new', timestamp: 300 })];
  const { api, calls } = cloud(remote);
  const snapshot = state([
    card('same-image', { cloudAccount: ACCOUNT, imageDriveId: 'same', imageBase64: 'cached-same' }),
    card('new-image', { cloudAccount: ACCOUNT, imageDriveId: 'old', imageBase64: 'cached-old' }),
  ]);
  const synced = await synchronizeCards(snapshot, ACCOUNT, api);
  const applied = applySyncResult(snapshot, snapshot, synced, ACCOUNT);
  assert.equal(applied.cards.find(c => c.id === 'same-image')?.name, 'Cloud edit');
  assert.equal(applied.cards.find(c => c.id === 'same-image')?.imageBase64, 'cached-same');
  assert.equal(applied.cards.find(c => c.id === 'new-image')?.imageBase64, undefined);
  assert.equal(calls.filter(c => c.action === 'write').length, 0);
});

test('failed cloud deletion leaves all pending deletions intact for a safe retry', async () => {
  const { api, calls } = cloud();
  api.deleteCardFromSheet = async id => { calls.push({ action: 'delete', id }); if (id === 'fails') throw new Error('Drive unavailable'); };
  const snapshot = state([], [
    { id: 'done', account: ACCOUNT, deletedAt: 100 }, { id: 'fails', account: ACCOUNT, deletedAt: 101 },
  ]);
  await assert.rejects(synchronizeCards(snapshot, ACCOUNT, api), /Drive unavailable/);
  assert.equal(snapshot.deletions.length, 2);
  assert.deepEqual(calls, [{ action: 'delete', id: 'done' }, { action: 'delete', id: 'fails' }]);
});

test('only the exact deletion snapshot is acknowledged after sync', () => {
  const snapshot = state([], [{ id: 'deleted-again', account: ACCOUNT, deletedAt: 100 }, { id: 'done', account: ACCOUNT, deletedAt: 100 }]);
  const current = state([], [
    { id: 'deleted-again', account: ACCOUNT, deletedAt: 200 },
    { id: 'done', account: ACCOUNT, deletedAt: 100 },
    { id: 'other', account: OTHER, deletedAt: 100 },
  ]);
  const next = applySyncResult(current, snapshot, result([], ['deleted-again', 'done']), ACCOUNT);
  assert.deepEqual(next.deletions, [
    { id: 'deleted-again', account: ACCOUNT, deletedAt: 200 },
    { id: 'other', account: OTHER, deletedAt: 100 },
  ]);
});

test('account cancellation after image upload prevents any subsequent sheet write', async () => {
  const { api, calls } = cloud();
  let current = true;
  api.uploadImageToDrive = async (_image, id) => { calls.push({ action: 'image', id }); current = false; return 'drive-id'; };
  await assert.rejects(synchronizeCards(state([card('scan', { imageBase64: 'YQ==' })]), ACCOUNT, api, () => current), /同步已取消/);
  assert.deepEqual(calls, [{ action: 'read' }, { action: 'image', id: 'scan' }]);
});

test('applying an unchanged result preserves state identity to avoid an autosync loop', async () => {
  const snapshot = state([card('same', { cloudAccount: ACCOUNT, imageDriveId: 'photo', lastSyncedAt: 100, lastSyncedSheetId: 'sheet' })]);
  const { api, calls } = cloud([card('same', { imageDriveId: 'photo' })]);
  const synced = await synchronizeCards(snapshot, ACCOUNT, api);
  assert.equal(applySyncResult(snapshot, snapshot, synced, ACCOUNT), snapshot);
  assert.deepEqual(calls, [{ action: 'read' }]);
});


test('a card deleted on another device is removed locally instead of being uploaded again', async () => {
  const previouslySynced = card('remote-deleted', { cloudAccount: ACCOUNT, lastSyncedAt: 100, lastSyncedSheetId: 'sheet' });
  const snapshot = state([previouslySynced]);
  const { api, calls } = cloud();
  const synced = await synchronizeCards(snapshot, ACCOUNT, api);
  assert.deepEqual(synced.removed, ['remote-deleted']);
  assert.deepEqual(synced.cards, []);
  assert.deepEqual(calls, [{ action: 'read' }]);
  assert.deepEqual(applySyncResult(snapshot, snapshot, synced, ACCOUNT).cards, []);
});

test('unsent edits survive a remote deletion and are uploaded with a fresh sync marker', async () => {
  const edited = card('edited-after-sync', { cloudAccount: ACCOUNT, lastSyncedAt: 100, lastSyncedSheetId: 'sheet', timestamp: 200, name: 'Keep this edit' });
  const snapshot = state([edited]);
  const { api, calls } = cloud();
  const synced = await synchronizeCards(snapshot, ACCOUNT, api);
  assert.deepEqual(synced.removed, []);
  assert.equal(synced.cards[0].lastSyncedAt, 200);
  assert.equal(calls.find(c => c.action === 'write')?.card?.name, 'Keep this edit');
  assert.equal(applySyncResult(snapshot, snapshot, synced, ACCOUNT).cards[0].lastSyncedAt, 200);
});

test('remote deletion cannot remove a new edit, retrying scan, or another account during sync', () => {
  const synced = card('card', { cloudAccount: ACCOUNT, lastSyncedAt: 100, lastSyncedSheetId: 'sheet' });
  const snapshot = state([synced]);
  for (const updated of [
    { ...synced, timestamp: 200, name: 'Concurrent edit' },
    { ...synced, isProcessing: true },
    { ...synced, isError: true },
    { ...synced, cloudAccount: OTHER },
  ]) {
    const current = state([updated]);
    assert.equal(applySyncResult(current, snapshot, result([], [], ['card']), ACCOUNT).cards[0], updated);
  }
});

test('unsynced and legacy cards without a sync marker are uploaded rather than inferred deleted', async () => {
  const { api, calls } = cloud();
  const synced = await synchronizeCards(state([
    card('legacy', { cloudAccount: ACCOUNT }),
    card('unbound', { lastSyncedAt: 100 }),
  ]), ACCOUNT, api);
  assert.deepEqual(synced.removed, []);
  assert.deepEqual(calls.filter(c => c.action === 'write').map(c => c.id), ['legacy', 'unbound']);
  assert.ok(synced.cards.every(c => c.lastSyncedAt === c.timestamp));
});

test('remote downloads carry sync markers, including zero timestamps in legacy rows', async () => {
  const { api } = cloud([card('remote'), card('zero', { timestamp: 0 })]);
  const synced = await synchronizeCards(state([]), ACCOUNT, api);
  assert.equal(synced.cards.find(c => c.id === 'remote')?.lastSyncedAt, 100);
  assert.equal(synced.cards.find(c => c.id === 'zero')?.lastSyncedAt, 0);
  const empty = cloud();
  const next = await synchronizeCards(state(synced.cards), ACCOUNT, empty.api);
  assert.deepEqual(next.removed.sort(), ['remote', 'zero']);
});


test('a new spreadsheet cannot erase cards previously synced to another spreadsheet', async () => {
  const { api, calls } = cloud();
  const snapshot = state([
    card('old-database', { cloudAccount: ACCOUNT, lastSyncedAt: 100, lastSyncedSheetId: 'another-sheet' }),
    card('unknown-database', { cloudAccount: ACCOUNT, lastSyncedAt: 100 }),
  ]);
  const synced = await synchronizeCards(snapshot, ACCOUNT, api);
  assert.deepEqual(synced.removed, []);
  assert.deepEqual(calls.filter(c => c.action === 'write').map(c => c.id), ['old-database', 'unknown-database']);
  assert.ok(synced.cards.every(c => c.lastSyncedSheetId === 'sheet'));
  assert.equal(applySyncResult(snapshot, snapshot, synced, ACCOUNT).cards.length, 2);
});


test('restoring a local edit after remote deletion also restores its cached photo', async () => {
  const { api, calls } = cloud();
  const snapshot = state([card('edited', {
    cloudAccount: ACCOUNT, lastSyncedAt: 100, lastSyncedSheetId: 'sheet', timestamp: 200,
    imageDriveId: 'deleted-photo', imageBase64: 'YQ==',
  })]);
  const synced = await synchronizeCards(snapshot, ACCOUNT, api);
  assert.equal(synced.cards[0].imageDriveId, 'drive-edited');
  assert.equal(calls.find(c => c.action === 'write')?.card?.imageDriveId, 'drive-edited');
  assert.deepEqual(calls.map(c => c.action), ['read', 'image', 'write']);
});
