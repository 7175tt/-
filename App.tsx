import React, { useState, useCallback, useRef, useEffect } from 'react';
import { BusinessCard, AppView, GoogleUser, SyncStatus } from './types';
import { useCardStore } from './hooks/useCardStore';
import { scanBusinessCard, getScanReadiness } from './services/geminiService';
import { applySyncResult, belongsToAccount, synchronizeCards } from './services/syncService';
import * as GoogleApiService from './services/googleApiService';
import * as fileService from './services/fileService';
import CardList from './components/CardList';
import CardScanner from './components/CardScanner';
import CardForm from './components/CardForm';
import ConfirmationDialog from './components/ConfirmationDialog';
import InstructionsModal from './components/InstructionsModal';
import { GOOGLE_CLIENT_ID } from './config';

declare const gapi: any;
const AUTH_KEY = 'KEEPER_GOOGLE_AUTH';
const nextTime = (previous = 0) => Math.max(Date.now(), previous + 1);
const blankCard = (): BusinessCard => ({ id: crypto.randomUUID(), name: '', company: '', title: '', phone: '', email: '', address: '', notes: '', rawText: '', timestamp: Date.now() });
const errorText = (error: unknown) => error instanceof Error ? error.message : '請稍後再試。';

export default function App() {
  const { state, update, ready, saving, blocked, error: storageError, retrySave } = useCardStore();
  const stateRef = useRef(state);
  stateRef.current = state;
  const [view, setView] = useState(AppView.LIST);
  const [editing, setEditing] = useState<BusinessCard | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [restoreCards, setRestoreCards] = useState<BusinessCard[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BusinessCard | null>(null);
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(null);
  const [gapiReady, setGapiReady] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [googleAttempt, setGoogleAttempt] = useState(0);
  const [syncStatus, setSyncStatus] = useState(SyncStatus.LOCAL);
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [scanReady, setScanReady] = useState<boolean | null>(null);
  const [syncTick, setSyncTick] = useState(0);
  const [queueTick, setQueueTick] = useState(0);
  const [capturedCount, setCapturedCount] = useState(0);
  const generation = useRef(0);
  const syncing = useRef(false);
  const syncRequested = useRef(false);
  const scans = useRef(new Map<string, AbortController>());
  const excelInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const userRef = useRef(googleUser);
  userRef.current = googleUser;
  const cards = googleUser ? state.cards.filter(c => belongsToAccount(c, googleUser.email)) : state.cards;
  const notify = useCallback((type: 'error' | 'success', message: string) => setNotice({ type, message }), []);

  useEffect(() => {
    // Migration has already read the legacy account metadata; its bearer token
    // is no longer needed in persistent browser storage.
    if (ready && !storageError) {
      try { localStorage.removeItem(AUTH_KEY); } catch { /* Storage may be restricted. */ }
    }
  }, [ready, storageError]);

  useEffect(() => {
    if (notice?.type !== 'success') return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const onOnline = () => { setOnline(true); setSyncTick(t => t + 1); };
    const onOffline = () => setOnline(false);
    const onFocus = () => { if (document.visibilityState === 'visible') setSyncTick(t => t + 1); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onFocus);
    const timer = setInterval(onFocus, 60_000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onFocus);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getScanReadiness(controller.signal).then(r => setScanReady(r.configured)).catch(() => {});
    return () => controller.abort();
  }, [online, syncTick]);

  const handleAuth = useCallback(async (token: any) => {
    if (token.error) {
      notify('error', 'Google 登入未完成，名片仍保留在本機。請重新登入。');
      return;
    }
    const currentGeneration = ++generation.current;
    userRef.current = null;
    setGoogleUser(null);
    setSpreadsheetId(null);
    try {
      // Clear any previous account's cached Drive/Sheet IDs before applying its new token.
      GoogleApiService.signOut();
      gapi.client.setToken(token);
      const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error('無法讀取 Google 帳號，請重新登入。');
      const profile = await response.json();
      if (typeof profile.email !== 'string' || !profile.email) throw new Error('無法確認登入帳號。');
      if (generation.current !== currentGeneration) return;
      const user = { name: profile.name || profile.email, email: profile.email, picture: profile.picture || '' };
      userRef.current = user;
      setGoogleUser(user);
      setSyncStatus(SyncStatus.READY_TO_SYNC);
      setGoogleError(null);
      // Session-only tokens; do not keep bearer tokens in persistent local storage.
      try {
        sessionStorage.setItem(AUTH_KEY, JSON.stringify({ tokenResponse: token, user, expiresAt: Date.now() + (Number(token.expires_in) || 3600) * 1000 }));
        localStorage.removeItem(AUTH_KEY);
      } catch { /* Login can work even when browser storage for the session is unavailable. */ }
      notify('success', '已登入，正在自動同步此帳號與未同步的本機名片。');
    } catch (error) {
      if (generation.current !== currentGeneration) return;
      setSyncStatus(SyncStatus.ERROR);
      setGoogleUser(null);
      GoogleApiService.signOut();
      notify('error', errorText(error));
    }
  }, [notify]);
  const authRef = useRef(handleAuth);
  authRef.current = handleAuth;

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.includes('PLACEHOLDER')) {
      setGoogleError('目前尚未啟用 Google 同步，可以先在本機整理名片。');
      return;
    }
    let active = true;
    (async () => {
      try {
        await GoogleApiService.loadGapi();
        if (!active) return;
        await GoogleApiService.initGis(token => authRef.current(token));
        if (!active) return;
        setGapiReady(true);
        setGoogleError(null);
        try {
          const saved = JSON.parse(sessionStorage.getItem(AUTH_KEY) || 'null');
          if (saved?.expiresAt > Date.now() && typeof saved.user?.email === 'string' && saved.tokenResponse?.access_token) {
            generation.current++;
            GoogleApiService.signOut();
            gapi.client.setToken(saved.tokenResponse);
            userRef.current = saved.user;
            setGoogleUser(saved.user);
            setSyncStatus(SyncStatus.READY_TO_SYNC);
          }
        } catch { /* A malformed/expired session does not prevent local work. */ }
      } catch {
        if (active) {
          setGapiReady(false);
          setGoogleError('Google 暫時無法連線，本機名片不受影響。');
        }
      }
    })();
    return () => { active = false; };
  }, [googleAttempt]);

  const sync = useCallback(async (manual = false) => {
    const user = userRef.current;
    if (!user || !online || !ready || saving || storageError) return;
    if (syncing.current) { syncRequested.current = true; return; }
    syncing.current = true;
    syncRequested.current = false;
    const runGeneration = generation.current;
    const snapshot = stateRef.current;
    const isCurrent = () => runGeneration === generation.current && userRef.current?.email === user.email;
    setSyncStatus(SyncStatus.SYNCING);
    try {
      // Persist account ownership before the first remote write. Otherwise a
      // partial upload followed by switching accounts could copy private cards.
      const unbound = snapshot.cards.filter(c => !c.cloudAccount);
      if (unbound.length) {
        const recoveredImages = new Map<string, string>();
        for (const card of unbound.filter(c => c.imageDriveId && !c.imageBase64)) {
          try { recoveredImages.set(card.id, await GoogleApiService.getImageAsBase64(card.imageDriveId!)); }
          catch { throw new Error('有舊版名片的照片尚未下載，請登入原本的 Google 帳號再同步，或先備份文字資料。'); }
          if (!isCurrent()) return;
        }
        if (!isCurrent()) return;
        update(current => ({ ...current, cards: current.cards.map(card => !card.cloudAccount && unbound.some(c => c.id === card.id) ? {
          ...card, cloudAccount: user.email,
          imageBase64: card.imageBase64 || (unbound.some(original => original.id === card.id && original.timestamp === card.timestamp && original.imageDriveId === card.imageDriveId) ? recoveredImages.get(card.id) : undefined),
          imageDriveId: undefined, lastSyncedAt: undefined, lastSyncedSheetId: undefined,
        } : card) }));
        setSyncStatus(SyncStatus.READY_TO_SYNC);
        return;
      }
      const result = await synchronizeCards(snapshot, user.email, GoogleApiService, isCurrent);
      if (!isCurrent()) return;
      update(current => applySyncResult(current, snapshot, result, user.email));
      setSpreadsheetId(result.spreadsheetId);
      setSyncStatus(stateRef.current === snapshot ? SyncStatus.SYNCED : SyncStatus.READY_TO_SYNC);
      if (manual) notify('success', '雲端同步完成。');
    } catch (error) {
      if (isCurrent()) {
        setSyncStatus(SyncStatus.ERROR);
        notify('error', `雲端同步未完成，變更仍保留在本機。${errorText(error)}`);
      }
    } finally {
      syncing.current = false;
      if (syncRequested.current) setSyncTick(t => t + 1);
    }
  }, [online, ready, saving, storageError, update, notify]);

  useEffect(() => {
    if (!googleUser || !ready || saving || storageError || !online) return;
    const timer = setTimeout(() => void sync(), 1000);
    return () => clearTimeout(timer);
  }, [state, googleUser, ready, saving, storageError, online, syncTick, sync]);

  useEffect(() => {
    if (!ready) return;
    // A small queue allows continuous capture without unbounded AI requests.
    const candidates = state.cards.filter(c => c.isProcessing && !scans.current.has(c.id));
    for (const card of candidates.slice(0, Math.max(0, 2 - scans.current.size))) {
      const controller = new AbortController();
      scans.current.set(card.id, controller);
      (async () => {
        try {
          if (!online) throw new Error('目前離線，照片已保存。連線後請點選重新辨識。');
          if (scanReady === false) throw new Error('AI 掃描尚未啟用，照片已保存。您可以先手動輸入。');
          if (!card.imageBase64) throw new Error('找不到名片照片，請重新拍攝。');
          const data = await scanBusinessCard(card.imageBase64, controller.signal);
          if (controller.signal.aborted) return;
          update(current => ({ ...current, cards: current.cards.map(c => c.id === card.id && c.isProcessing ? {
            ...c, ...data, timestamp: nextTime(c.timestamp), isProcessing: false, isError: false, errorMessage: undefined, needsReview: true,
          } : c) }));
        } catch (error) {
          if (!controller.signal.aborted) update(current => ({ ...current, cards: current.cards.map(c => c.id === card.id && c.isProcessing ? {
            ...c, isProcessing: false, isError: true, errorMessage: errorText(error),
          } : c) }));
        } finally {
          scans.current.delete(card.id);
          // Completion can coincide with a cancelled/deleted card; advance the queue anyway.
          setQueueTick(t => t + 1);
        }
      })();
    }
  }, [state.cards, ready, online, scanReady, update, queueTick]);

  useEffect(() => () => { scans.current.forEach(controller => controller.abort()); scans.current.clear(); }, []);
  useEffect(() => {
    if (!ready || (!saving && !storageError && !state.cards.some(c => c.isProcessing))) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [ready, saving, storageError, state.cards]);

  const capture = useCallback((imageBase64: string) => {
    const card = { ...blankCard(), imageBase64, isProcessing: true, cloudAccount: userRef.current?.email };
    update(current => ({ ...current, cards: [card, ...current.cards] }));
    setCapturedCount(count => count + 1);
  }, [update]);
  const retry = (card: BusinessCard) => {
    update(current => ({ ...current, cards: current.cards.map(c => c.id === card.id ? { ...c, isProcessing: true, isError: false, errorMessage: undefined } : c) }));
  };
  const addManual = () => {
    setEditing({ ...blankCard(), cloudAccount: googleUser?.email });
    setCreating(true);
    setView(AppView.EDITING);
  };
  const edit = (card: BusinessCard) => {
    setEditing(card);
    setCreating(false);
    setView(AppView.EDITING);
  };
  const saveCard = (card: BusinessCard) => {
    scans.current.get(card.id)?.abort();
    update(current => {
      const existing = current.cards.find(c => c.id === card.id);
      const photoChanged = card.imageBase64 !== editing?.imageBase64 || card.imageDriveId !== editing?.imageDriveId;
      const saved = {
        ...card, cloudAccount: existing?.cloudAccount || card.cloudAccount,
        lastSyncedAt: existing?.lastSyncedAt,
        lastSyncedSheetId: existing?.lastSyncedSheetId,
        imageDriveId: photoChanged ? card.imageDriveId : existing?.imageDriveId || card.imageDriveId,
        imageBase64: photoChanged ? card.imageBase64 : existing?.imageBase64 || card.imageBase64,
        isError: false, isProcessing: false, needsReview: false, errorMessage: undefined,
        timestamp: nextTime(existing?.timestamp ?? card.timestamp),
      };
      return { ...current, cards: existing ? current.cards.map(c => c.id === saved.id ? saved : c) : [saved, ...current.cards] };
    });
    setEditing(null);
    setView(AppView.LIST);
    notify('success', '名片已更新。');
  };
  const remove = (targets: BusinessCard[]) => {
    const ids = new Set(targets.map(c => c.id));
    for (const id of ids) scans.current.get(id)?.abort();
    update(current => ({
      cards: current.cards.filter(c => !ids.has(c.id)),
      deletions: [...current.deletions, ...targets.flatMap(card => {
        const account = card.cloudAccount || googleUser?.email;
        return account && !current.deletions.some(d => d.id === card.id && d.account === account)
          ? [{ id: card.id, account, deletedAt: Date.now() }] : [];
      })],
    }));
    setDeleteTarget(null);
    setClearConfirm(false);
    notify('success', '名片已刪除；有雲端副本時會自動同步刪除。');
  };
  const logout = () => {
    generation.current++;
    userRef.current = null;
    GoogleApiService.signOut();
    setGoogleUser(null);
    setSpreadsheetId(null);
    setSyncStatus(SyncStatus.LOCAL);
    try { sessionStorage.removeItem(AUTH_KEY); localStorage.removeItem(AUTH_KEY); } catch { /* Local data remains available. */ }
    notify('success', '已登出，名片仍保留於這個瀏覽器。');
  };
  const login = () => {
    try { GoogleApiService.signInWithPopup(); } catch (error) { notify('error', errorText(error)); }
  };
  const importCards = (incoming: BusinessCard[]) => {
    update(current => {
      const ids = new Set(current.cards.map(c => c.id));
      const additions = incoming.filter(c => !ids.has(c.id)).map(c => ({
        ...c, imageDriveId: undefined, lastSyncedAt: undefined, lastSyncedSheetId: undefined, cloudAccount: googleUser?.email,
        timestamp: nextTime(c.timestamp), isProcessing: false,
      }));
      // A restore can intentionally recover a deleted card. Cancel that pending deletion.
      const restored = new Set(additions.map(c => c.id));
      return { cards: [...additions, ...current.cards], deletions: current.deletions.filter(d => !restored.has(d.id) || d.account !== googleUser?.email) };
    });
    notify('success', '匯入完成；已有相同編號的名片保持原樣。');
  };
  const importExcel = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const imported = await fileService.importFromExcel(file, stateRef.current.cards);
      if (!imported.length) notify('success', '沒有新的名片可匯入。');
      else importCards(imported);
    } catch (error) { notify('error', errorText(error)); }
  };
  const restore = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try { setRestoreCards(await fileService.importFromJson(file)); }
    catch (error) { notify('error', errorText(error)); }
  };
  const backup = async () => {
    try {
      const complete = [];
      for (const card of cards) {
        if (card.imageDriveId && !card.imageBase64) {
          if (!googleUser || card.cloudAccount !== googleUser.email) throw new Error('部分照片只在雲端，請登入對應的 Google 帳號後建立完整備份。');
          complete.push({ ...card, imageBase64: await GoogleApiService.getImageAsBase64(card.imageDriveId) });
        } else complete.push(card);
      }
      fileService.exportToJson(complete);
    } catch (error) { notify('error', `完整備份未完成：${errorText(error)}`); }
  };
  const cacheImage = useCallback((id: string, base64: string) => {
    update(current => ({ ...current, cards: current.cards.map(c => c.id === id && !c.imageBase64 ? { ...c, imageBase64: base64 } : c) }));
  }, [update]);

  const statusText = storageError ? '尚未保存 · 請保留頁面並重試或下載備份'
    : !online ? '目前離線 · 變更保留本機，連線後自動同步'
    : saving ? '正在保存到這個裝置…'
    : googleUser ? syncStatus === SyncStatus.SYNCING ? '正在同步到您的 Google 雲端…'
      : syncStatus === SyncStatus.ERROR ? '雲端同步待重試 · 本機資料保留'
      : syncStatus === SyncStatus.SYNCED ? '本機已儲存 · 已與 Google 同步' : '本機已儲存 · 等待自動同步'
    : '本機已儲存 · 登入 Google 後自動同步';

  return (
    <div className="h-dvh min-h-0 w-full bg-gray-900 text-white flex flex-col overflow-hidden">
      {notice && <div role={notice.type === 'error' ? 'alert' : 'status'} className={`fixed top-3 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-lg p-3 rounded-xl shadow-lg z-[80] flex gap-3 ${notice.type === 'error' ? 'bg-red-900' : 'bg-emerald-800'}`}>
        <span className="flex-1 text-sm whitespace-pre-wrap">{notice.message}</span>
        <button aria-label="關閉提示" onClick={() => setNotice(null)} className="px-2">×</button>
      </div>}
      {ready && storageError && <div role="alert" className="z-[70] bg-red-950 p-3 text-sm">{storageError} <button className="underline" onClick={retrySave}>重試保存</button> <button className="underline ml-3" onClick={() => void backup()}>先下載備份</button></div>}
      {!ready ? <main className="flex-1 grid place-items-center p-6 text-center" role={storageError ? 'alert' : 'status'}><p className="max-w-sm text-gray-200">{storageError || (blocked ? '名片管家已在另一個分頁開啟。請關閉另一個分頁，此頁會自動接續。' : '正在讀取名片…')}</p></main> : <>
        <div className="shrink-0 px-4 py-2 text-xs bg-gray-950 text-gray-300 flex items-center justify-between gap-2" role="status">
          <span>{statusText}</span>
          {googleUser && <div className="flex gap-3">
            {syncStatus === SyncStatus.ERROR && gapiReady && <button onClick={login} className="text-blue-300 whitespace-nowrap">重新登入</button>}
            <button onClick={() => void sync(true)} disabled={!online || saving || syncStatus === SyncStatus.SYNCING} className="text-blue-300 whitespace-nowrap disabled:opacity-50">立即同步</button>
          </div>}
        </div>
        {googleError && <div className="shrink-0 px-4 py-2 text-xs text-amber-200 bg-amber-950/40">{googleError} <button className="underline ml-2" onClick={() => setGoogleAttempt(n => n + 1)}>重新連線 Google</button></div>}
        {scanReady === false && <div className="shrink-0 px-4 py-2 text-xs text-amber-200 bg-amber-950/40">AI 掃描尚未啟用；可以先拍照留存或手動輸入名片。</div>}
        <input type="file" ref={excelInput} onChange={importExcel} className="hidden" accept=".xlsx,.xls" />
        <input type="file" ref={jsonInput} onChange={restore} className="hidden" accept=".json" />
        <main className="flex-1 min-h-0">
          {view === AppView.SCANNING ? <CardScanner onCaptureAndProcess={capture} onFinish={() => setView(AppView.LIST)} isConfigError={false} pendingCount={state.cards.filter(c => c.isProcessing).length} capturedCount={capturedCount} onManualEntry={addManual} />
            : view === AppView.EDITING && editing ? <CardForm cardData={editing} onSave={saveCard} onCancel={() => setView(AppView.LIST)} isConfigError={false} mode={creating ? 'create' : editing.needsReview || editing.isError ? 'review' : 'edit'} />
            : <CardList cards={cards} onScanNew={() => { setCapturedCount(0); setView(AppView.SCANNING); }} onAddManual={addManual} onRetryCard={retry} onDeleteCard={id => setDeleteTarget(cards.find(c => c.id === id) || null)} onEditCard={edit}
                onExportExcel={() => void fileService.exportToExcel(cards).catch(error => notify('error', `Excel 匯出未完成：${errorText(error)}`))} onImportExcel={() => excelInput.current?.click()} onExportJson={() => void backup()} onRestoreJson={() => jsonInput.current?.click()}
                onClearAll={() => setClearConfirm(true)} onShowInstructions={() => setShowInstructions(true)} googleUser={googleUser} syncStatus={syncStatus} isGapiReady={gapiReady} onGoogleLogin={login} onGoogleLogout={logout}
                onForceSync={() => void sync(true)} spreadsheetId={spreadsheetId} onLazyImageLoaded={cacheImage} canLoadCloudImages={!!googleUser} />}
        </main>
      </>}
      <ConfirmationDialog isOpen={!!deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={() => deleteTarget && remove([deleteTarget])} title="刪除這張名片？" message="這會刪除本機名片；若有雲端副本，也會在同步時刪除。" confirmButtonText="確定刪除" />
      <ConfirmationDialog isOpen={clearConfirm} onCancel={() => setClearConfirm(false)} onConfirm={() => remove(cards)} title="刪除所有顯示的名片？" message="此操作無法復原。建議先建立完整備份，雲端刪除會在連線後同步。" confirmButtonText="確定刪除" />
      <ConfirmationDialog isOpen={restoreCards !== null} onCancel={() => setRestoreCards(null)} onConfirm={() => { if (restoreCards) importCards(restoreCards); setRestoreCards(null); }} title="合併備份中的名片" message="保留目前的名片，只加入編號尚未存在的資料。備份中的雲端連結不會跨帳號使用。" confirmButtonText="確定還原" />
      {showInstructions && <InstructionsModal onClose={() => setShowInstructions(false)} />}
    </div>
  );
}
