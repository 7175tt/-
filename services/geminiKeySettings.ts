/** Kept separate from contact data, IndexedDB snapshots, exports and cloud sync. */
export const GEMINI_API_KEY_STORAGE_KEY = 'business-card-keeper:gemini-api-key';

export interface GeminiKeySettings {
  readonly apiKey: string;
  readonly remember: boolean;
  readonly error: string | null;
}

type KeyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface KeySettingsOptions {
  sessionStorage: () => KeyStorage | null;
  localStorage: () => KeyStorage | null;
  subscribeToChanges?: (listener: () => void) => () => void;
}

const FORMAT_ERROR = '金鑰格式不正確，請貼上 20–256 個英文字母、數字、底線或連字號。';
const READ_ERROR = '無法讀取金鑰設定，請檢查瀏覽器的儲存權限。';
const SAVE_ERROR = '金鑰未能完整儲存，請檢查瀏覽器的儲存權限後重試。';
const CLEAR_ERROR = '金鑰未能完整移除，請檢查瀏覽器的儲存權限後重試。';

export function normalizeGeminiApiKey(value: string): string {
  const key = value.trim();
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(key)) throw new Error(FORMAT_ERROR);
  return key;
}

const validStoredKey = (value: string | null | undefined): string => {
  if (!value) return '';
  try { return normalizeGeminiApiKey(value); } catch { return ''; }
};

/** Storage is injected so failure recovery can be checked without a browser or credentials. */
export function createGeminiKeySettingsStore(options: KeySettingsOptions) {
  let snapshot: GeminiKeySettings = Object.freeze({ apiKey: '', remember: false, error: null });
  let initialized = false;
  const listeners = new Set<() => void>();
  let stopListening: (() => void) | undefined;

  const publish = (next: GeminiKeySettings) => {
    if (snapshot.apiKey === next.apiKey && snapshot.remember === next.remember && snapshot.error === next.error) return;
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };

  const refresh = (errorOverride?: string) => {
    let sessionValue: string | null | undefined;
    let localValue: string | null | undefined;
    let readFailed = false;
    try { sessionValue = options.sessionStorage()?.getItem(GEMINI_API_KEY_STORAGE_KEY); } catch { readFailed = true; }
    try { localValue = options.localStorage()?.getItem(GEMINI_API_KEY_STORAGE_KEY); } catch { readFailed = true; }
    const sessionKey = validStoredKey(sessionValue);
    const localKey = validStoredKey(localValue);
    const malformed = (!!sessionValue && !sessionKey) || (!!localValue && !localKey);
    publish({
      apiKey: sessionKey || localKey || (readFailed ? snapshot.apiKey : ''),
      remember: sessionKey ? false : localKey ? true : readFailed ? snapshot.remember : false,
      error: errorOverride || (readFailed ? READ_ERROR : malformed ? '已儲存的金鑰格式不正確，請重新設定或移除。' : null),
    });
    initialized = true;
  };

  const getSettings = (): GeminiKeySettings => {
    if (!initialized) refresh();
    return snapshot;
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    if (listeners.size === 1) {
      refresh();
      stopListening = options.subscribeToChanges?.(() => refresh());
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) { stopListening?.(); stopListening = undefined; }
    };
  };

  const commit = (key: string | null, remember: boolean, errorMessage: string) => {
    getSettings();
    const completed: Array<{ storage: KeyStorage; previous: string | null }> = [];
    try {
      const session = options.sessionStorage();
      const local = options.localStorage();
      if (!session || !local) throw new Error('Storage unavailable');
      const previousSession = session.getItem(GEMINI_API_KEY_STORAGE_KEY);
      const previousLocal = local.getItem(GEMINI_API_KEY_STORAGE_KEY);
      const target = remember ? local : session;
      const other = remember ? session : local;
      const previousTarget = remember ? previousLocal : previousSession;
      const previousOther = remember ? previousSession : previousLocal;
      // Write the replacement before removing its predecessor. A failed write cannot erase it.
      for (const change of [
        { storage: target, previous: previousTarget, next: key },
        { storage: other, previous: previousOther, next: null },
      ]) {
        if (change.previous === change.next) continue;
        if (change.next === null) change.storage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
        else change.storage.setItem(GEMINI_API_KEY_STORAGE_KEY, change.next);
        completed.push(change);
      }
      publish({ apiKey: key || '', remember: !!key && remember, error: null });
    } catch {
      // Compensate a partially completed move; never expose browser exception text containing keys.
      for (const change of completed.reverse()) {
        try {
          if (change.previous === null) change.storage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
          else change.storage.setItem(GEMINI_API_KEY_STORAGE_KEY, change.previous);
        } catch { /* Refresh below reports the actual surviving storage and the failure. */ }
      }
      refresh(errorMessage);
      throw new Error(errorMessage);
    }
  };

  const save = (value: string, remember = false) => {
    let normalized: string;
    try { normalized = normalizeGeminiApiKey(value); }
    catch {
      publish({ ...getSettings(), error: FORMAT_ERROR });
      throw new Error(FORMAT_ERROR);
    }
    commit(normalized, remember, SAVE_ERROR);
  };
  const clear = () => commit(null, false, CLEAR_ERROR);

  return { getSettings, subscribe, save, clear };
}

const browserStore = createGeminiKeySettingsStore({
  sessionStorage: () => typeof window === 'undefined' ? null : window.sessionStorage,
  localStorage: () => typeof window === 'undefined' ? null : window.localStorage,
  subscribeToChanges: listener => {
    if (typeof window === 'undefined') return () => {};
    const onChange = (event: StorageEvent) => {
      if (event.key === null || event.key === GEMINI_API_KEY_STORAGE_KEY) listener();
    };
    window.addEventListener('storage', onChange);
    return () => window.removeEventListener('storage', onChange);
  },
});

export const getGeminiKeySettings = browserStore.getSettings;
export const subscribeGeminiKeySettings = browserStore.subscribe;
export const saveGeminiApiKey = browserStore.save;
export const clearGeminiApiKey = browserStore.clear;
