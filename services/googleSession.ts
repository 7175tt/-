const DEVICE = 'KEEPER_GOOGLE_DEVICE';
export function rememberedGoogleEmail(): string {
  try { const value = localStorage.getItem(DEVICE); return value && value.includes('@') ? value : ''; } catch { return ''; }
}
export function rememberGoogleEmail(email: string | null) {
  try { if (email) localStorage.setItem(DEVICE, email); else localStorage.removeItem(DEVICE); } catch { /* Device memory is optional. */ }
}
export class GoogleSessionError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export async function googleSessionRequest(action: 'session' | 'code' | 'logout', body?: unknown, signal?: AbortSignal): Promise<any> {
  const response = await fetch(`/api/google/${action}`, {
    method: 'POST', credentials: 'same-origin', redirect: 'error',
    keepalive: action === 'logout',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XmlHttpRequest' },
    body: JSON.stringify(body || {}), signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(35_000)]),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new GoogleSessionError(response.status === 401 ? 'Google 授權已失效，請按「重新連線 Google」。' : 'Google 連線暫時無法更新，稍後會再試。', response.status);
  return result;
}
export async function googleSessionConfiguration(): Promise<{ persistentConfigured: boolean; clientId?: string }> {
  try {
    const response = await fetch('/api/google/status', { credentials: 'same-origin', signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return { persistentConfigured: false };
    return await response.json();
  } catch { return { persistentConfigured: false }; }
}
