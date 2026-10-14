import type { BusinessCard } from '../types';
import { LOCAL_STORAGE_KEY } from '../constants';
import { readContactMetadata } from './contactMetadata';

export interface CardDeletion {
  id: string;
  account: string;
  deletedAt: number;
}

export interface CardStoreState {
  cards: BusinessCard[];
  deletions: CardDeletion[];
}

export interface CardStorageOptions {
  indexedDB?: IDBFactory;
  legacyStorage?: Pick<Storage, 'getItem'> | null;
  databaseName?: string;
  locks?: Pick<LockManager, 'request'> | null;
}

export interface CardStorageLease {
  /** Release only after every already-queued transaction has settled. */
  release: () => Promise<void>;
}

export interface CardStorageLeaseOptions {
  signal?: AbortSignal;
  onBlocked?: () => void;
}

export class CardStorageError extends Error {
  constructor(
    message: string,
    public readonly recoveredState: CardStoreState,
    public readonly hasLoadedSnapshot: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CardStorageError';
  }
}

const STORE = 'snapshots';
const SNAPSHOT = 'current';
const EMPTY = (): CardStoreState => ({ cards: [], deletions: [] });
const INTERRUPTED_MESSAGE = '上次辨識尚未完成。照片已保留，請重新辨識或手動填寫。';

function normalizeCards(value: unknown): BusinessCard[] {
  if (!Array.isArray(value)) throw new Error('名片資料格式無效。');
  return value.map((item) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) {
      throw new Error('名片資料格式無效；原始資料已保留。');
    }
    const card: BusinessCard = { ...item, ...readContactMetadata(item) };
    for (const field of ['name', 'company', 'title', 'phone', 'email', 'address', 'notes', 'rawText'] as const) {
      if (card[field] == null) card[field] = '';
      if (typeof card[field] !== 'string') throw new Error('名片欄位格式無效；原始資料已保留。');
    }
    if (!Number.isFinite(card.timestamp)) card.timestamp = 0;
    if (card.isProcessing) {
      card.isProcessing = false;
      card.isError = true;
      card.needsReview = true;
      card.errorMessage = INTERRUPTED_MESSAGE;
    }
    return card;
  });
}

function normalizeState(value: unknown): CardStoreState {
  if (!value || typeof value !== 'object') throw new Error('本機名片資料格式無效。');
  const source = value as CardStoreState;
  if (!Array.isArray(source.deletions) || source.deletions.some((item) =>
    !item || typeof item.id !== 'string' || typeof item.account !== 'string' || !Number.isFinite(item.deletedAt))) {
    throw new Error('待同步刪除紀錄格式無效；原始資料已保留。');
  }
  return { cards: normalizeCards(source.cards), deletions: source.deletions.map((item) => ({ ...item })) };
}

/** One snapshot commits photos, card edits and deletion tombstones atomically. */
export function createCardStorage(options: CardStorageOptions = {}) {
  let queue: Promise<unknown> = Promise.resolve();
  const databaseName = options.databaseName ?? 'business-card-keeper';
  let owner: { closing: boolean } | null = null;
  const enqueue = <T,>(operation: () => Promise<T>): Promise<T> => {
    if (!owner || owner.closing) {
      return Promise.reject(new Error('此分頁尚未取得名片儲存權限，請關閉其他名片管家分頁後再試。'));
    }
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
  };

  async function acquireLease({ signal, onBlocked }: CardStorageLeaseOptions = {}): Promise<CardStorageLease> {
    const locks = options.locks === undefined ? globalThis.navigator?.locks : options.locks;
    if (!locks) {
      throw new Error('此瀏覽器無法安全協調名片儲存。請使用最新版 Safari、Chrome 或 Firefox，並透過 HTTPS 開啟。');
    }
    if (signal?.aborted) throw new DOMException('分頁已關閉。', 'AbortError');
    const lockName = `card-store:${databaseName}:writer`;
    return new Promise<CardStorageLease>((resolve, reject) => {
      const hold = async () => {
        if (signal?.aborted) throw new DOMException('分頁已關閉。', 'AbortError');
        const token = { closing: false };
        owner = token;
        let unlock!: () => void;
        const released = new Promise<void>(done => { unlock = done; });
        let releasePromise: Promise<void> | undefined;
        const release = () => {
          if (!releasePromise) {
            token.closing = true;
            signal?.removeEventListener('abort', onAbort);
            // Reject new operations immediately, but keep the browser lock while
            // existing writes commit. The next tab must read their final result.
            releasePromise = queue.then(() => {
              if (owner === token) owner = null;
              unlock();
            });
          }
          return releasePromise;
        };
        const onAbort = () => { void release(); };
        signal?.addEventListener('abort', onAbort, { once: true });
        resolve({ release });
        await released;
      };
      // The nonblocking probe lets the UI distinguish loading from another tab.
      // `signal` is intentionally used only on the queued request: browsers
      // reject combining AbortSignal with the ifAvailable option.
      void Promise.resolve().then(() => locks.request(lockName, { mode: 'exclusive', ifAvailable: true }, lock => {
        if (signal?.aborted) throw new DOMException('分頁已關閉。', 'AbortError');
        if (lock) return hold();
        onBlocked?.();
        return locks.request(lockName, { mode: 'exclusive', ...(signal ? { signal } : {}) }, hold);
      })).catch(reject);
    });
  }

  function readLegacy(): CardStoreState {
    const storage = options.legacyStorage === undefined ? globalThis.localStorage : options.legacyStorage;
    if (!storage) return EMPTY();
    const raw = storage.getItem(LOCAL_STORAGE_KEY);
    const cards = raw ? normalizeCards(JSON.parse(raw)) : [];
    let account = '';
    // Only the known account scopes old Drive file IDs and pending deletions.
    // Authentication tokens are neither copied nor returned by this module.
    try {
      const auth = JSON.parse(storage.getItem('KEEPER_GOOGLE_AUTH') || 'null');
      if (typeof auth?.user?.email === 'string') account = auth.user.email;
    } catch { /* Missing old authentication does not discard local cards. */ }
    const rawDeletions: unknown = JSON.parse(storage.getItem('KEEPER_DELETED_LOG') || '[]');
    if (!Array.isArray(rawDeletions) || rawDeletions.some((id) => typeof id !== 'string')) {
      throw new Error('舊版刪除紀錄格式無效；原始資料已保留。');
    }
    return {
      cards: cards.map((card) => card.imageDriveId && !card.cloudAccount && account ? { ...card, cloudAccount: account } : card),
      deletions: rawDeletions.map((id: string) => ({ id, account, deletedAt: Date.now() })),
    };
  }

  function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const factory = options.indexedDB ?? globalThis.indexedDB;
      if (!factory) {
        reject(new Error('此瀏覽器無法使用 IndexedDB。'));
        return;
      }
      const request = factory.open(databaseName, 1);
      let rejected = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        if (rejected) { request.result.close(); return; }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error('無法開啟本機資料庫。'));
      request.onblocked = () => {
        rejected = true;
        reject(new Error('請關閉其他舊版名片管家分頁後重試。'));
      };
    });
  }

  function readSnapshot(db: IDBDatabase): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).get(SNAPSHOT);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? new Error('本機資料讀取中斷。'));
      transaction.onerror = () => { /* onabort reports the completed failed transaction. */ };
    });
  }

  function writeSnapshot(db: IDBDatabase, state: CardStoreState): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('本機儲存中斷；先前資料仍保留。'));
      transaction.onerror = () => { /* Wait for abort; a put success alone is not a durable commit. */ };
      try {
        transaction.objectStore(STORE).put({ version: 1, ...state }, SNAPSHOT);
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
  }

  return {
    acquireLease,
    load: (): Promise<CardStoreState> => enqueue(async () => {
      let db: IDBDatabase | undefined;
      let recoveredState = EMPTY();
      let hasLoadedSnapshot = false;
      try {
        db = await openDatabase();
        const snapshot = await readSnapshot(db);
        recoveredState = snapshot === undefined ? readLegacy() : normalizeState(snapshot);
        hasLoadedSnapshot = true;
        const interrupted = snapshot && (snapshot as CardStoreState).cards.some((card) => card.isProcessing);
        if (snapshot === undefined || interrupted) await writeSnapshot(db, recoveredState);
        // Keep the old localStorage key intact as a recovery backup. Once this
        // transaction commits, future loads exclusively use the IDB snapshot.
        return recoveredState;
      } catch (cause) {
        if (!hasLoadedSnapshot) {
          try { recoveredState = readLegacy(); } catch { /* Never replace corrupt original data. */ }
        }
        throw new CardStorageError(
          '無法完整讀取或儲存本機名片。請保持頁面開啟並下載備份，再重試儲存。',
          recoveredState,
          hasLoadedSnapshot,
          { cause },
        );
      } finally { db?.close(); }
    }),
    save: (state: CardStoreState): Promise<void> => {
      // Capture the value at invocation rather than after earlier writes finish.
      const snapshot = structuredClone(state);
      return enqueue(async () => {
        const db = await openDatabase();
        try { await writeSnapshot(db, snapshot); } finally { db.close(); }
      });
    },
  };
}

const browserStorage = createCardStorage();
export const acquireCardStoreLease = browserStorage.acquireLease;
export const loadCardStore = browserStorage.load;
export const saveCardStore = browserStorage.save;
