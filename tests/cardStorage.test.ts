import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { CardStorageError, createCardStorage, type CardStorageOptions, type CardStoreState } from '../services/cardStorage';
import type { BusinessCard } from '../types';

const card = (id: string, extra: Partial<BusinessCard> = {}): BusinessCard => ({
  id, name: '王小明', company: '範例公司', title: '經理', phone: '0912345678',
  email: 'contact@example.com', address: '', notes: '', rawText: '', timestamp: 1,
  ...extra,
});
const legacy = (entries: Record<string, string>) => ({ getItem: (key: string) => entries[key] ?? null });

/** Minimal exclusive lock scheduler; real browser handoff is also covered by browser-storage-smoke.py. */
class TestLocks {
  private held = new Set<string>();
  private pending = new Map<string, Array<() => void>>();
  request = ((name: string, options: LockOptions, callback: LockGrantedCallback) => {
    if (options.signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    if (options.ifAvailable && this.held.has(name)) return Promise.resolve().then(() => callback(null));
    return new Promise((resolve, reject) => {
      const waiting = this.pending.get(name) ?? [];
      this.pending.set(name, waiting);
      const abort = () => {
        const index = waiting.indexOf(run);
        if (index >= 0) waiting.splice(index, 1);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const release = () => { this.held.delete(name); this.startNext(name); };
      const run = () => {
        this.held.add(name);
        options.signal?.removeEventListener('abort', abort);
        Promise.resolve().then(() => callback({ name, mode: 'exclusive' })).then(
          value => { resolve(value); release(); },
          error => { reject(error); release(); },
        );
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      waiting.push(run);
      this.startNext(name);
    });
  }) as LockManager['request'];
  private startNext(name: string) {
    if (!this.held.has(name)) this.pending.get(name)?.shift()?.();
  }
}

async function openStorage(options: CardStorageOptions) {
  const storage = createCardStorage({ locks: new TestLocks(), ...options });
  const lease = await storage.acquireLease();
  return { ...storage, loadMetadata: storage.load, load: async () => {
    const state = await storage.load();
    const cards = [];
    for (const card of state.cards) {
      const { imageLocalId, ...metadata } = card;
      cards.push(imageLocalId ? { ...metadata, imageBase64: await storage.getPhoto(imageLocalId) } : metadata);
    }
    return { ...state, cards };
  }, release: lease.release };
}

test('264 photos stay outside metadata and text edits do not rewrite photo payloads', async () => {
  const storage = await openStorage({ indexedDB: new IDBFactory(), legacyStorage: null });
  await storage.load();
  const cards = Array.from({ length: 264 }, (_, i) => card(`photo-${i}`, { imageBase64: `original-${i}-` + 'A'.repeat(64 * 1024) }));
  const compact = await storage.save({ cards, deletions: [] });
  assert.ok(compact.cards.every(item => !item.imageBase64 && item.imageLocalId));
  assert.ok(JSON.stringify(compact).length < 200_000);
  assert.equal(await storage.getPhoto(compact.cards[263].imageLocalId!), cards[263].imageBase64);
  await storage.saveThumbnail(compact.cards[0].imageLocalId!, 'data:image/jpeg;base64,synthetic-thumbnail');
  const originalPut = IDBObjectStore.prototype.put;
  const writes: string[] = [];
  IDBObjectStore.prototype.put = function (...args) { writes.push(this.name); return originalPut.apply(this, args); };
  try {
    await storage.save({ ...compact, cards: compact.cards.map((item, i) => i ? item : { ...item, name: '只改文字' }) });
    assert.deepEqual(writes, ['snapshots']);
  } finally { IDBObjectStore.prototype.put = originalPut; }
  assert.equal(await storage.getPhoto('thumbnail:' + compact.cards[0].imageLocalId!), 'data:image/jpeg;base64,synthetic-thumbnail');
  const replacement = await storage.save({ ...compact, cards: compact.cards.map((item, i) => i ? item : { ...item, imageBase64: 'replacement' }) });
  assert.equal(await storage.getPhoto(replacement.cards[0].imageLocalId!), 'replacement');
  assert.equal(await storage.getPhoto(compact.cards[0].imageLocalId!), undefined);
  assert.equal(await storage.getPhoto('thumbnail:' + compact.cards[0].imageLocalId!), undefined);
  assert.equal(await storage.getPhoto(compact.cards[263].imageLocalId!), cards[263].imageBase64);
});

test('an existing version-one IndexedDB snapshot upgrades atomically with every original photo', async () => {
  const indexedDB = new IDBFactory();
  const old = { cards: [card('old-indexeddb', { imageBase64: 'old-original' })], deletions: [{ id: 'deleted', account: 'owner@example.invalid', deletedAt: 1 }] };
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('upgrade-test', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('snapshots');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result; const tx = db.transaction('snapshots', 'readwrite');
      tx.objectStore('snapshots').put({ version: 1, ...old }, 'current');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    };
  });
  const storage = await openStorage({ indexedDB, databaseName: 'upgrade-test', legacyStorage: null });
  const metadata = await storage.loadMetadata();
  assert.equal(metadata.cards[0].imageBase64, undefined);
  assert.equal(await storage.getPhoto(metadata.cards[0].imageLocalId!), 'old-original');
  assert.deepEqual(metadata.deletions, old.deletions);
  assert.deepEqual(await storage.load(), old);
});

test('photo write failure rolls back metadata and preserves the prior original', async () => {
  const storage = await openStorage({ indexedDB: new IDBFactory(), legacyStorage: null });
  await storage.load();
  const saved = await storage.save({ cards: [card('photo', { imageBase64: 'original' })], deletions: [] });
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    if (this.name === 'photos') throw new DOMException('Full', 'QuotaExceededError');
    return originalPut.apply(this, args);
  };
  try { await assert.rejects(storage.save({ cards: [card('photo', { imageBase64: 'replacement' })], deletions: [] })); }
  finally { IDBObjectStore.prototype.put = originalPut; }
  assert.deepEqual(await storage.loadMetadata(), saved);
  assert.equal(await storage.getPhoto(saved.cards[0].imageLocalId!), 'original');
  await assert.rejects(storage.save({ cards: [card('dangling', { imageLocalId: 'not-stored' })], deletions: [] }));
  assert.deepEqual(await storage.loadMetadata(), saved);
});

test('migration commits cards and scoped pending deletions, preserving the original legacy backup', async () => {
  const previous = card('old', { imageDriveId: 'drive-photo', imageBase64: 'data:image/jpeg;base64,AAAA' });
  const entries = {
    'business-cards-db': JSON.stringify([previous]),
    KEEPER_DELETED_LOG: JSON.stringify(['deleted']),
    KEEPER_GOOGLE_AUTH: JSON.stringify({ user: { email: 'owner@example.com' }, tokenResponse: { access_token: 'not-copied' } }),
  };
  const storage = await openStorage({ indexedDB: new IDBFactory(), legacyStorage: legacy(entries) });
  const state = await storage.load();
  assert.deepEqual(state.cards, [{ ...previous, cloudAccount: 'owner@example.com' }]);
  assert.equal(state.deletions[0].id, 'deleted');
  assert.equal(state.deletions[0].account, 'owner@example.com');
  assert.equal(entries['business-cards-db'], JSON.stringify([previous]));
  assert.ok(!JSON.stringify(state).includes('not-copied'));
  entries['business-cards-db'] = JSON.stringify([card('stale-backup')]);
  assert.deepEqual(await storage.load(), state, 'the committed snapshot takes precedence over the preserved backup');
});

test('failed migration retains legacy data and can be retried without data loss', async () => {
  const entries = { 'business-cards-db': JSON.stringify([card('legacy')]) };
  const storage = await openStorage({ indexedDB: new IDBFactory(), legacyStorage: legacy(entries) });
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () { throw new DOMException('Disk full', 'QuotaExceededError'); };
  try {
    await assert.rejects(storage.load(), (error: unknown) => {
      assert.ok(error instanceof CardStorageError);
      assert.equal(error.hasLoadedSnapshot, true);
      assert.equal(error.recoveredState.cards[0].id, 'legacy');
      return true;
    });
    assert.equal(JSON.parse(entries['business-cards-db'])[0].id, 'legacy');
  } finally { IDBObjectStore.prototype.put = originalPut; }
  assert.equal((await storage.load()).cards[0].id, 'legacy');
});

test('write failure preserves the prior durable snapshot and does not poison later writes', async () => {
  const storage = await openStorage({ indexedDB: new IDBFactory(), legacyStorage: null });
  const initial: CardStoreState = { cards: [card('saved')], deletions: [] };
  await storage.load();
  await storage.save(initial);
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () { throw new DOMException('Disk full', 'QuotaExceededError'); };
  try { await assert.rejects(storage.save({ cards: [card('unsaved')], deletions: [] })); }
  finally { IDBObjectStore.prototype.put = originalPut; }
  assert.deepEqual(await storage.load(), initial);
  await storage.save({ cards: [card('retried')], deletions: [] });
  assert.equal((await storage.load()).cards[0].id, 'retried');
});

test('an aborted transaction never reports a successful save or partially replaces its snapshot', async () => {
  const storage = await openStorage({ indexedDB: new IDBFactory(), legacyStorage: null });
  const initial: CardStoreState = { cards: [card('saved')], deletions: [] };
  await storage.load();
  await storage.save(initial);
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const request = originalPut.apply(this, args);
    request.addEventListener('success', () => this.transaction.abort());
    return request;
  };
  try {
    await assert.rejects(storage.save({
      cards: [card('must-not-appear')],
      deletions: [{ id: 'saved', account: 'owner@example.com', deletedAt: 1 }],
    }));
  } finally { IDBObjectStore.prototype.put = originalPut; }
  assert.deepEqual(await storage.load(), initial);
});

test('a failed initial database read exposes legacy fallback without claiming the durable store was loaded', async () => {
  const indexedDB = new IDBFactory();
  indexedDB.open = () => { throw new DOMException('Storage unavailable', 'SecurityError'); };
  const storage = await openStorage({
    indexedDB,
    legacyStorage: legacy({ 'business-cards-db': JSON.stringify([card('fallback')]) }),
  });
  await assert.rejects(storage.load(), (error: unknown) => {
    assert.ok(error instanceof CardStorageError);
    assert.equal(error.hasLoadedSnapshot, false);
    assert.equal(error.recoveredState.cards[0].id, 'fallback');
    return true;
  });
});

test('an interrupted capture recovers its photo and becomes retryable on reload', async () => {
  const indexedDB = new IDBFactory();
  const storage = await openStorage({ indexedDB, legacyStorage: null });
  await storage.load();
  await storage.save({ cards: [card('pending', { isProcessing: true, imageBase64: 'data:image/jpeg;base64,AAAA' })], deletions: [] });
  await storage.release();
  const reloaded = await openStorage({ indexedDB, legacyStorage: null });
  const recovered = (await reloaded.load()).cards[0];
  assert.equal(recovered.isProcessing, false);
  assert.equal(recovered.isError, true);
  assert.equal(recovered.needsReview, true);
  assert.match(recovered.errorMessage ?? '', /重新辨識/);
  assert.equal(recovered.imageBase64, 'data:image/jpeg;base64,AAAA');
  assert.deepEqual((await reloaded.load()).cards[0], recovered);
});

test('queued writes retain the latest photos and account-scoped deletion tombstones after reload', async () => {
  const indexedDB = new IDBFactory();
  const storage = await openStorage({ indexedDB, legacyStorage: null });
  await storage.load();
  const latest: CardStoreState = {
    cards: [card('second', { imageBase64: 'data:image/jpeg;base64,BBBB' })],
    deletions: [{ id: 'removed', account: 'owner@example.com', deletedAt: 15 }],
  };
  await Promise.all([
    storage.save({ cards: [card('first')], deletions: [] }),
    storage.save(latest),
  ]);
  await storage.release();
  const reloaded = await openStorage({ indexedDB, legacyStorage: null });
  assert.deepEqual(await reloaded.load(), latest);
});

test('legacy deletions without a known account are preserved without assigning a new account', async () => {
  const storage = await openStorage({
    indexedDB: new IDBFactory(),
    legacyStorage: legacy({ KEEPER_DELETED_LOG: '["old-removal"]' }),
  });
  assert.equal((await storage.load()).deletions[0].account, '');
});

test('a second client cannot read, normalize active scans, or overwrite the first until ownership is handed off', async () => {
  const options = { indexedDB: new IDBFactory(), legacyStorage: null, locks: new TestLocks() };
  const first = await openStorage(options);
  await first.load();
  const pendingCard = card('active-scan', { isProcessing: true, imageBase64: 'AAAA' });
  await first.save({ cards: [pendingCard], deletions: [] });
  const second = createCardStorage(options);
  let blocked!: () => void;
  const blockedPromise = new Promise<void>(resolve => { blocked = resolve; });
  let secondAcquired = false;
  const nextLease = second.acquireLease({ onBlocked: blocked }).then(lease => { secondAcquired = true; return lease; });
  await blockedPromise;
  assert.equal(secondAcquired, false);
  await assert.rejects(second.load(), /尚未取得/);
  await assert.rejects(second.save({ cards: [], deletions: [] }), /尚未取得/);
  // The original tab finishes its scan while the waiting tab has no write access.
  const finished = { ...pendingCard, name: 'Finished in first tab', isProcessing: false };
  await first.save({ cards: [finished], deletions: [] });
  await first.release();
  const lease = await nextLease;
  const loaded = await second.load();
  const { imageLocalId, ...metadata } = loaded.cards[0];
  assert.deepEqual({ ...metadata, imageBase64: await second.getPhoto(imageLocalId!) }, finished);
  await second.save({ ...loaded, cards: [...loaded.cards, card('second-tab-addition')] });
  assert.deepEqual((await second.load()).cards.map(item => item.id), ['active-scan', 'second-tab-addition']);
  await lease.release();
});

test('unmount cancellation holds ownership until an already queued write commits before the next client reads', async () => {
  const options = { indexedDB: new IDBFactory(), legacyStorage: null, locks: new TestLocks() };
  const first = createCardStorage(options);
  const controller = new AbortController();
  const firstLease = await first.acquireLease({ signal: controller.signal });
  await first.load();
  const second = createCardStorage(options);
  let writeStarted!: () => void;
  const started = new Promise<void>(resolve => { writeStarted = resolve; });
  const originalPut = IDBObjectStore.prototype.put;
  let keepTransactionOpen = true;
  IDBObjectStore.prototype.put = function (...args) {
    const request = originalPut.apply(this, args);
    writeStarted();
    const keepAlive = () => {
      const read = this.get('current');
      read.onsuccess = () => { if (keepTransactionOpen) keepAlive(); };
    };
    request.addEventListener('success', keepAlive);
    return request;
  };
  try {
    const write = first.save({ cards: [card('last-write')], deletions: [] });
    await started;
    controller.abort();
    const releasing = firstLease.release();
    let blocked!: () => void;
    const blockedPromise = new Promise<void>(resolve => { blocked = resolve; });
    let acquired = false;
    const nextLease = second.acquireLease({ onBlocked: blocked }).then(lease => { acquired = true; return lease; });
    await blockedPromise;
    assert.equal(acquired, false);
    await assert.rejects(first.save({ cards: [], deletions: [] }), /尚未取得/);
    keepTransactionOpen = false;
    await write;
    await releasing;
    const lease = await nextLease;
    assert.equal((await second.load()).cards[0].id, 'last-write');
    await lease.release();
  } finally {
    keepTransactionOpen = false;
    IDBObjectStore.prototype.put = originalPut;
  }
});

test('cancelled waiting tabs do not retain a lock or prevent the next tab from opening', async () => {
  const options = { indexedDB: new IDBFactory(), legacyStorage: null, locks: new TestLocks() };
  const first = await openStorage(options);
  const cancelled = createCardStorage(options);
  const controller = new AbortController();
  let blocked!: () => void;
  const blockedPromise = new Promise<void>(resolve => { blocked = resolve; });
  const waiting = cancelled.acquireLease({ signal: controller.signal, onBlocked: blocked });
  const rejection = assert.rejects(waiting, { name: 'AbortError' });
  await blockedPromise;
  controller.abort();
  await rejection;
  await first.release();
  const next = await openStorage(options);
  assert.deepEqual(await next.load(), { cards: [], deletions: [] });
  await next.release();
});

test('an immediately cancelled mount cannot steal ownership from its replacement mount', async () => {
  const storage = createCardStorage({ indexedDB: new IDBFactory(), legacyStorage: null, locks: new TestLocks() });
  const controller = new AbortController();
  const cancelled = storage.acquireLease({ signal: controller.signal });
  const rejection = assert.rejects(cancelled, { name: 'AbortError' });
  controller.abort();
  const active = await storage.acquireLease();
  await rejection;
  await storage.load();
  await storage.save({ cards: [card('strict-mode-remount')], deletions: [] });
  assert.equal((await storage.load()).cards[0].id, 'strict-mode-remount');
  await active.release();
});

test('browsers without Web Locks fail closed instead of permitting unsafe snapshot writes', async () => {
  const storage = createCardStorage({ indexedDB: new IDBFactory(), legacyStorage: null, locks: null });
  await assert.rejects(storage.acquireLease(), /最新版 Safari、Chrome 或 Firefox/);
  await assert.rejects(storage.load(), /尚未取得/);
  await assert.rejects(storage.save({ cards: [card('unsafe')], deletions: [] }), /尚未取得/);
});
