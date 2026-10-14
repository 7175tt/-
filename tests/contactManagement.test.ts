import test from 'node:test';
import assert from 'node:assert/strict';
import type { BusinessCard } from '../types';
import { calendarLink, decodeContactMetadata, encodeContactMetadata, isCalendarDate, localDate, mergeSources, parseLabels, pendingFollowUps, readContactMetadata, visibleContacts } from '../services/contactMetadata';
import { duplicateReasons, findDuplicatePairs, mergeContacts } from '../services/contactDuplicates';
import { parseCardBackup } from '../services/backupValidation';
import { matchesCard } from '../services/cardSearch';
import { cardsToVCard } from '../services/contactExport';
import { applySyncResult, synchronizeCards } from '../services/syncService';

const card = (id: string, patch: Partial<BusinessCard> = {}): BusinessCard => ({ id, name: '王小明', company: '自動化公司', title: '', phone: '0912-345-678', email: 'person@example.invalid', address: '', notes: '', rawText: '', timestamp: 100, ...patch });
const followUp = { id: 'task', text: '寄型錄', dueDate: '2026-10-16', createdAt: 10 };
const metadata = { tags: ['供應商'], events: ['自動化展'], followUps: [followUp], interactions: [{ id: 'interaction', text: '想了解視覺檢測', occurredOn: '2026-10-14', createdAt: 20 }] };

test('metadata survives JSON and cloud sync without entering vCard fields', async () => {
  const original = card('card', metadata);
  assert.deepEqual(decodeContactMetadata(encodeContactMetadata(original)), metadata);
  assert.deepEqual(parseCardBackup(JSON.stringify([original]))[0], original);
  const state = { cards: [original], deletions: [] };
  assert.ok(!cardsToVCard([original]).includes('想了解視覺檢測'));
  assert.ok(!cardsToVCard([original]).includes('寄型錄'));
  const sent: BusinessCard[] = [];
  const result = await synchronizeCards(state, 'owner@example.invalid', {
    getCloudCardsLight: async () => ({ cards: [], spreadsheetId: 'sheet' }),
    uploadImageToDrive: async () => 'image', updateCardInSheet: async value => { sent.push(value); }, deleteCardFromSheet: async () => {},
  });
  assert.deepEqual(sent[0].followUps, [followUp]);
  const edited = { cards: [{ ...original, timestamp: 200, interactions: [] }], deletions: [] };
  assert.deepEqual(applySyncResult(edited, state, result, 'owner@example.invalid').cards[0].interactions, []);
});

test('old metadata stays optional and malformed or unsupported history fails before import', () => {
  assert.deepEqual(decodeContactMetadata(''), {});
  for (const value of ['broken', '{"version":2}', '{"tags":1}', '{"tags":[3]}', '{"followUps":[{"text":"missing fields"}]}']) assert.throws(() => decodeContactMetadata(value));
  for (const bad of [{ tags: 'string' }, { followUps: [{ ...followUp, dueDate: '2026-02-30' }] }, { followUps: [followUp, followUp] }, { interactions: [{ ...metadata.interactions[0], createdAt: -1 }] }]) {
    assert.throws(() => parseCardBackup(JSON.stringify([card('ok'), card('bad', bad as any)])));
  }
  assert.throws(() => readContactMetadata({ tags: ['x'.repeat(81)] }), /80/);
  assert.throws(() => readContactMetadata({ interactions: Array.from({ length: 40 }, (_, i) => ({ ...metadata.interactions[0], id: String(i), text: 'x'.repeat(2000) })) }), /過長/);
  assert.deepEqual(parseLabels('供應商、供應商，ＡＩ,ai\n展會'), ['供應商', 'ai', '展會']);
});

test('calendar dates handle leap days, month boundaries and user timezone without day shifts', () => {
  assert.ok(isCalendarDate('2028-02-29'));
  assert.equal(isCalendarDate('2026-02-29'), false);
  assert.equal(isCalendarDate('2026-13-01'), false);
  assert.equal(localDate(new Date(2026, 9, 14, 0, 30)), '2026-10-14');
  const url = new URL(calendarLink(card('a', { notes: 'PRIVATE NOTE', ...metadata }), { ...followUp, text: '寄 A&B 型錄', dueDate: '2026-12-31' }));
  assert.equal(url.searchParams.get('dates'), '20261231/20270101');
  assert.match(url.searchParams.get('text')!, /A&B/);
  assert.ok(!url.href.includes('PRIVATE'));
  assert.equal(pendingFollowUps(card('a', { followUps: [followUp, { ...followUp, id: 'done', completedAt: 0 }] })).length, 1);
});

test('search finds event, tags, pending tasks and interactions using existing multi-term rules', () => {
  assert.ok(matchesCard(card('a', metadata), '自動化展 供應商 型錄'));
  assert.ok(matchesCard(card('a', metadata), '視覺檢測'));
  assert.equal(matchesCard(card('a', metadata), '視覺檢測', 'name'), false);
});

test('duplicate candidates normalize email, Taiwan phones and names without guessing same names alone', () => {
  assert.ok(duplicateReasons(card('a'), card('b', { name: '另一人', company: '其他', phone: '+886 912 345 678', email: 'PERSON@EXAMPLE.INVALID' })).length === 2);
  assert.equal(duplicateReasons(card('a', { phone: '', email: '' }), card('b', { company: '不同公司', phone: '', email: '' })).length, 0);
  assert.equal(duplicateReasons(card('a'), card('b', { cloudAccount: 'other' })).length, 0);
  assert.equal(duplicateReasons(card('a'), card('b', { isProcessing: true })).length, 0);
  assert.equal(findDuplicatePairs([card('a'), card('b'), card('c', { cloudAccount: 'other' })]).length, 1);
});

test('merge requires every conflict decision and atomically preserves both originals and their photos', () => {
  const left = card('left', { ...metadata, imageBase64: 'bGVmdA==', imageDriveId: 'left-photo', cloudAccount: 'owner' });
  const right = card('right', { title: '新職稱', company: '新公司', tags: ['朋友'], events: ['交流會'], imageBase64: 'cmlnaHQ=', cloudAccount: 'owner', rawText: '新照片原文' });
  const initial = { cards: [left, right], deletions: [] };
  assert.throws(() => mergeContacts(initial, left, right, {}), /公司/);
  const { state, merged } = mergeContacts(initial, left, right, { company: 'right' }, right.imageBase64, 200);
  assert.equal(merged.company, '新公司');
  assert.equal(merged.title, '新職稱');
  assert.equal(merged.imageBase64, right.imageBase64);
  assert.equal(merged.imageDriveId, undefined);
  assert.deepEqual(merged.tags, ['供應商', '朋友']);
  assert.equal(merged.followUps?.[0].text, '寄型錄');
  assert.equal(state.cards.length, 3);
  assert.equal(state.deletions.length, 0);
  assert.deepEqual(initial.cards, [left, right]);
  assert.equal(state.cards.find(value => value.id === left.id)?.imageDriveId, 'left-photo');
  assert.deepEqual(visibleContacts(state.cards), [merged]);
  assert.equal(mergeSources(state.cards, merged.id).length, 2);
  assert.equal(parseCardBackup(JSON.stringify(state.cards)).length, 3);
  assert.equal(visibleContacts(state.cards.map(value => value.id === left.id ? { ...value, mergedIntoId: undefined } : value)).length, 2);
  assert.throws(() => mergeContacts(state, left, right, { company: 'right' }), /已變更/);
});

test('stale merges and cross-account merges never change cards or deletion queues', () => {
  const a = card('a'), b = card('b');
  assert.throws(() => mergeContacts({ cards: [{ ...a, timestamp: 101 }, b], deletions: [] }, a, b, {}), /已變更/);
  assert.throws(() => mergeContacts({ cards: [{ ...a, cloudAccount: 'owner' }, b], deletions: [] }, a, b, {}), /已變更/);
  const other = card('b', { cloudAccount: 'other' });
  assert.throws(() => mergeContacts({ cards: [a, other], deletions: [] }, a, other, {}), /同一帳號/);
});

test('orphaned, cyclic and cross-account merge links remain visible', () => {
  const a = card('a', { mergedIntoId: 'b' }), b = card('b', { mergedIntoId: 'a' });
  assert.equal(visibleContacts([a]).length, 1);
  assert.equal(visibleContacts([a, b]).length, 2);
  assert.equal(visibleContacts([a, card('b', { cloudAccount: 'other' })]).length, 2);
});

test('visible contacts recovered from incomplete backups can be merged again', () => {
  const orphan = card('old', { mergedIntoId: 'missing' }), fresh = card('fresh');
  const { state, merged } = mergeContacts({ cards: [orphan, fresh], deletions: [] }, orphan, fresh, {});
  assert.deepEqual(visibleContacts(state.cards), [merged]);
  assert.equal(mergeSources(state.cards, merged.id).length, 2);
});
