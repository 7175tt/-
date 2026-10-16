import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { acquireCardStoreLease, CardStorageError, loadCardStore, saveCardStore, type CardStorageLease, type CardStoreState } from '../services/cardStorage';

export type { CardDeletion, CardStoreState } from '../services/cardStorage';

const emptyState = (): CardStoreState => ({ cards: [], deletions: [] });
type Mutation = SetStateAction<CardStoreState>;
const apply = (state: CardStoreState, mutation: Mutation): CardStoreState =>
  typeof mutation === 'function' ? mutation(state) : mutation;

export function useCardStore(): {
  state: CardStoreState;
  update: Dispatch<SetStateAction<CardStoreState>>;
  ready: boolean;
  blocked: boolean;
  saving: boolean;
  error: string | null;
  retrySave: () => void;
} {
  const [state, setState] = useState<CardStoreState>(emptyState);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [leaseReady, setLeaseReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const current = useRef(state);
  const readyRef = useRef(false);
  const hasLoaded = useRef(false);
  const pending = useRef<Mutation[]>([]);
  const latestRevision = useRef(0);

  const markDirty = useCallback(() => {
    latestRevision.current += 1;
    setRevision(latestRevision.current);
  }, []);

  const update = useCallback<Dispatch<Mutation>>((mutation) => {
    // Calls during hydration are replayed on top of the loaded snapshot.
    if (!readyRef.current) {
      pending.current.push(mutation);
      return;
    }
    const next = apply(current.current, mutation);
    if (Object.is(next, current.current)) return;
    if (!hasLoaded.current) pending.current.push(mutation);
    current.current = next;
    setState(current.current);
    markDirty();
  }, [markDirty]);

  useEffect(() => {
    let active = true;
    let lease: CardStorageLease | undefined;
    const controller = new AbortController();
    void acquireCardStoreLease({
      signal: controller.signal,
      onBlocked: () => { if (active) setBlocked(true); },
    }).then(acquired => {
      lease = acquired;
      if (!active) { void acquired.release(); return; }
      setBlocked(false);
      setLeaseReady(true);
    }, (cause: unknown) => {
      if (!active) return;
      setBlocked(false);
      setError(cause instanceof Error ? cause.message : '無法取得安全的名片儲存權限，請重新開啟瀏覽器後再試。');
    });
    return () => {
      active = false;
      controller.abort();
      void lease?.release();
    };
  }, []);

  useEffect(() => {
    if (!leaseReady) return;
    let active = true;
    const accept = (loaded: CardStoreState, writable: boolean, failure: string | null) => {
      if (!active) return;
      const mutations = pending.current;
      const next = mutations.reduce<CardStoreState>(apply, loaded);
      current.current = next;
      hasLoaded.current = writable;
      readyRef.current = true;
      if (writable) pending.current = [];
      setState(next);
      setReady(true);
      setSaving(false);
      setError(failure);
      if (writable && !Object.is(next, loaded)) markDirty();
    };
    void loadCardStore().then(
      (loaded) => accept(loaded, true, null),
      (cause: unknown) => {
        if (cause instanceof CardStorageError) {
          accept(cause.recoveredState, cause.hasLoadedSnapshot, cause.message);
        } else {
          accept(emptyState(), false, '無法讀取本機名片。請保持頁面開啟並下載備份，再重試儲存。');
        }
      },
    );
    return () => { active = false; };
  }, [leaseReady, loadAttempt, markDirty]);

  useEffect(() => {
    if (!ready || !hasLoaded.current || revision === 0) return;
    let active = true;
    setSaving(true);
    const snapshot = current.current;
    void saveCardStore(snapshot).then(
      (stored) => {
        const sources = new Map(snapshot.cards.map(card => [card.id, card]));
        const saved = new Map(stored.cards.map(card => [card.id, card]));
        let changed = false;
        const cards = current.current.cards.map(card => {
          const compact = saved.get(card.id);
          const source = sources.get(card.id);
          if (!card.imageBase64 || !compact?.imageLocalId || source?.imageBase64 !== card.imageBase64 || source.cloudAccount !== card.cloudAccount || source.imageDriveId !== card.imageDriveId) return card;
          changed = true;
          const { imageBase64: _, ...metadata } = card;
          return { ...metadata, imageLocalId: compact.imageLocalId };
        });
        if (changed) { current.current = { ...current.current, cards }; setState(current.current); }
        if (active && revision === latestRevision.current) {
          setSaving(false);
          setError(null);
        }
      },
      () => {
        if (active && revision === latestRevision.current) {
          setSaving(false);
          setError('名片尚未儲存，可能是瀏覽器空間不足。請保持頁面開啟並下載備份，再重試儲存。');
        }
      },
    );
    return () => { active = false; };
  }, [ready, revision]);

  // A failed first read must be retried before writes are allowed: blindly
  // saving fallback data could otherwise overwrite an unread durable snapshot.
  const retrySave = useCallback(() => {
    if (!hasLoaded.current) {
      setSaving(true);
      setLoadAttempt((attempt) => attempt + 1);
    } else markDirty();
  }, [markDirty]);

  return { state, update, ready, blocked, saving, error, retrySave };
}

export default useCardStore;
