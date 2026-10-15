import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Icon from './Icon';
import { checkGeminiApiKey, ScanRequestError } from '../services/geminiService';
import { clearGeminiApiKey, getGeminiKeySettings, normalizeGeminiApiKey, saveGeminiApiKey, subscribeGeminiKeySettings } from '../services/geminiKeySettings';

interface GeminiKeySettingsProps {
  onClose: () => void;
  sharedKeyAvailable: boolean;
}

const testErrorMessage = (error: unknown): string => {
  const code = error instanceof ScanRequestError ? error.code : '';
  switch (code) {
    case 'INVALID_API_KEY': case 'API_KEY_INVALID': case 'INVALID_KEY': case 'API_KEY_REQUIRED':
      return '金鑰無效，請確認已完整貼上，或在 Google AI Studio 建立新的金鑰。';
    case 'API_KEY_RESTRICTED': case 'PERMISSION_DENIED': case 'FORBIDDEN':
      return '這把金鑰目前沒有使用權限，請檢查 Google AI Studio 的專案與金鑰限制。';
    case 'RATE_LIMITED': case 'RESOURCE_EXHAUSTED': case 'QUOTA_EXCEEDED':
      return '目前請求過多或配額不足，請稍後再試，並確認 Gemini 的使用配額。';
    case 'BILLING_REQUIRED':
      return '目前專案需要啟用付費或調整配額，請到 Google AI Studio 檢查。';
    case 'NETWORK_ERROR':
      return '無法連線，請確認網路後重試。您仍可先儲存金鑰。';
    case 'SCAN_TIMEOUT': case 'CHECK_TIMEOUT': case 'REQUEST_TIMEOUT': case 'TIMEOUT':
      return '連線測試逾時，請稍後重試。您仍可先儲存金鑰。';
    case 'HTTPS_REQUIRED':
      return '請透過 HTTPS 開啟網站後再測試，避免金鑰經由未加密的連線傳送。';
    case 'MODEL_UNAVAILABLE':
      return '目前辨識模型暫時無法使用，請稍後重試或聯絡網站管理者。';
    default:
      return '連線測試未完成，請稍後重試，或檢查金鑰與服務設定。';
  }
};

const GeminiKeySettings: React.FC<GeminiKeySettingsProps> = ({ onClose, sharedKeyAvailable }) => {
  const settings = useSyncExternalStore(subscribeGeminiKeySettings, getGeminiKeySettings, getGeminiKeySettings);
  const [value, setValue] = useState(settings.apiKey);
  const [remember, setRemember] = useState(settings.remember);
  const [visible, setVisible] = useState(false);
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  const requestRef = useRef<AbortController | null>(null);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href], [tabindex="0"]') || [])
        .filter(element => element.getBoundingClientRect().width > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
      document.removeEventListener('keydown', handleKey);
      if (previous?.isConnected) previous.focus();
      else document.getElementById('data-menu-toggle')?.focus();
    };
  }, []);

  const stopCheck = () => {
    requestRef.current?.abort();
    requestRef.current = null;
    setChecking(false);
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    stopCheck();
    try {
      saveGeminiApiKey(value, remember);
      setValue(getGeminiKeySettings().apiKey);
      setVisible(false);
      setFeedback({ kind: 'success', message: remember ? '金鑰已儲存在此裝置。可測試連線確認是否能使用。' : '金鑰已儲存在目前分頁。可測試連線確認是否能使用。' });
    } catch {
      setFeedback({ kind: 'error', message: getGeminiKeySettings().error || '無法儲存金鑰，請檢查瀏覽器設定後重試。' });
    }
  };

  const clear = () => {
    stopCheck();
    try {
      clearGeminiApiKey();
      setValue('');
      setRemember(false);
      setVisible(false);
      setFeedback({ kind: 'success', message: sharedKeyAvailable ? '個人金鑰已移除，後續辨識將使用網站提供的服務。' : '個人金鑰已移除。仍可拍照留存或手動新增名片。' });
    } catch {
      setFeedback({ kind: 'error', message: getGeminiKeySettings().error || '金鑰未能完整移除，請重試。' });
    }
  };

  const testConnection = async () => {
    let key: string;
    try { key = normalizeGeminiApiKey(value); }
    catch {
      setFeedback({ kind: 'error', message: '金鑰格式不正確，請完整貼上 Google AI Studio 提供的金鑰。' });
      return;
    }
    stopCheck();
    const controller = new AbortController();
    requestRef.current = controller;
    setChecking(true);
    setFeedback(null);
    try {
      await checkGeminiApiKey(key, controller.signal);
      if (requestRef.current === controller && !controller.signal.aborted) {
        const stored = getGeminiKeySettings();
        setFeedback({ kind: 'success', message: `測試成功，這把金鑰目前可以使用。${stored.apiKey === key && stored.remember === remember ? '' : '測試不會自動儲存，請按「儲存金鑰」套用。'}` });
      }
    } catch (error) {
      if (requestRef.current === controller && !controller.signal.aborted) setFeedback({ kind: 'error', message: testErrorMessage(error) });
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setChecking(false); }
    }
  };

  const errorMessage = feedback?.kind === 'error' ? feedback.message : settings.error;
  return (
    <div className="fixed inset-0 z-[90] bg-black/75 flex items-center justify-center p-3" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="gemini-settings-title" aria-describedby="gemini-settings-summary" className="w-full max-w-md max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 text-white shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 px-4 pt-3">
          <h2 ref={headingRef} id="gemini-settings-title" tabIndex={-1} className="text-lg font-semibold outline-none">AI 辨識設定</h2>
          <button type="button" onClick={onClose} aria-label="關閉設定" className="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-gray-300 hover:bg-gray-800"><Icon name="x-mark" className="h-5 w-5" /></button>
        </div>
        <form onSubmit={save} className="px-4 pb-4 space-y-4">
          <div id="gemini-settings-summary" className="text-sm leading-relaxed text-gray-300">
            <p>{settings.apiKey ? `已設定個人金鑰（${settings.remember ? '記住此裝置' : '目前分頁'}）。設定完成不代表已通過連線測試。` : sharedKeyAvailable ? '目前使用網站提供的 AI 辨識，也可以換成您自己的 Gemini 金鑰。' : '貼上您自己的 Gemini API 金鑰，即可啟用名片辨識。'}</p>
            <p className="mt-2">個人辨識額度與費用依金鑰所屬專案計算，與 Google 同步登入分開。</p>
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="inline-flex items-center min-h-11 text-blue-300 underline underline-offset-4">到 Google AI Studio 取得金鑰 ↗</a>
          </div>
          <div>
            <label htmlFor="gemini-api-key" className="block text-sm font-medium mb-2">Gemini API 金鑰</label>
            <div className="flex gap-2">
              <input id="gemini-api-key" type={visible ? 'text' : 'password'} value={value} onChange={event => { stopCheck(); setValue(event.target.value); setFeedback(null); }} placeholder="貼上 API 金鑰" maxLength={256} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} className="min-w-0 flex-1 min-h-11 rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500" aria-describedby="gemini-key-storage-help" />
              <button type="button" onClick={() => setVisible(show => !show)} aria-label={visible ? '隱藏金鑰' : '顯示金鑰'} className="min-h-11 px-3 rounded-lg bg-gray-800 text-sm text-gray-200">{visible ? '隱藏' : '顯示'}</button>
            </div>
          </div>
          <div>
            <label className="flex items-center gap-2 min-h-11 text-sm cursor-pointer"><input type="checkbox" checked={remember} onChange={event => { setRemember(event.target.checked); setFeedback(null); }} className="h-5 w-5 accent-blue-500" />在此裝置記住金鑰</label>
            <p id="gemini-key-storage-help" className="text-xs leading-relaxed text-gray-400">預設只保留在目前分頁；勾選後儲存在此瀏覽器，供下次使用。金鑰不會加入名片、備份或 Google 同步資料。</p>
          </div>
          <p className="text-xs leading-relaxed text-gray-400">辨識時，金鑰與照片會透過 HTTPS 經由本網站後端送至 Gemini；本網站後端不儲存金鑰。請只在您信任的網站輸入金鑰。</p>
          <div>
            <div className="grid grid-cols-2 gap-2">
              <button type="submit" disabled={!value.trim()} className="min-h-11 px-3 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50">儲存金鑰</button>
              <button type="button" onClick={() => void testConnection()} disabled={checking || !value.trim()} className="min-h-11 px-3 rounded-lg border border-gray-600 bg-gray-800 text-gray-100 disabled:opacity-50">{checking ? '測試中…' : '測試連線'}</button>
            </div>
            <p className="text-xs text-gray-400 mt-2 leading-relaxed">可先儲存，連網後再測試。測試會送出一個簡短請求，可能使用 Gemini 配額。</p>
          </div>
          {checking && <p role="status" className="text-sm text-blue-300">正在測試連線…</p>}
          {feedback?.kind === 'success' && <p role="status" className="text-sm text-emerald-300 leading-relaxed">{feedback.message}</p>}
          {errorMessage && <p role="alert" className="text-sm text-red-300 leading-relaxed">{errorMessage}</p>}
          {(settings.apiKey || settings.error) && <button type="button" onClick={clear} className="min-h-11 w-full rounded-lg text-red-300 hover:bg-red-950/40 text-sm">移除金鑰</button>}
        </form>
      </div>
    </div>
  );
};

export default GeminiKeySettings;
