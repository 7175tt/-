import express from 'express';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const COOKIE = '__Host-keeper_google_session';
const MAX_AGE = 90 * 24 * 60 * 60;
type Session = { refreshToken: string; subject: string; email: string; expiresAt: number };
interface Options {
  clientId?: string; clientSecret?: string; sessionSecret?: string; origin?: string;
  fetch?: typeof fetch; now?: () => number;
}

/** Google refresh credentials live only in an encrypted, HttpOnly device cookie. */
export function createGoogleSessionRouter(options: Options = {}) {
  const router = express.Router();
  const clientId = options.clientId ?? process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.env.VITE_GOOGLE_CLIENT_ID ?? '959741792176-makrjgf2p65l0a9p6kdsn7k0386v9vl2.apps.googleusercontent.com';
  const clientSecret = options.clientSecret ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const secret = options.sessionSecret ?? process.env.GOOGLE_SESSION_SECRET;
  const origin = options.origin ?? process.env.GOOGLE_AUTH_ORIGIN;
  const configured = !!(clientId && clientSecret && secret && secret.length >= 32 && origin && /^https:\/\/[^/]+$/.test(origin));
  const key = createHash('sha256').update(secret || '').digest();
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const aad = Buffer.from(`${COOKIE}:${clientId}`);
  const clear = (res: express.Response) => res.clearCookie(COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  const read = (req: express.Request): Session | null => {
    try {
      const cookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      if (!cookie || cookie.length > 3800) return null;
      const bytes = Buffer.from(decodeURIComponent(cookie), 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAAD(aad); decipher.setAuthTag(bytes.subarray(-16));
      const data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString());
      if (data.expiresAt <= now() || typeof data.refreshToken !== 'string' || !data.refreshToken || typeof data.subject !== 'string' || typeof data.email !== 'string') return null;
      return data;
    } catch { return null; }
  };
  const save = (res: express.Response, session: Session) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad);
    const bytes = Buffer.concat([iv, cipher.update(JSON.stringify(session)), cipher.final(), cipher.getAuthTag()]);
    res.cookie(COOKIE, bytes.toString('base64url'), { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: MAX_AGE * 1000 });
  };
  router.use((_req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); next(); });
  router.get('/status', (_req, res) => res.json({ persistentConfigured: configured, clientId: configured ? clientId : undefined }));
  router.use(express.json({ limit: '8kb' }));
  router.post('/logout', (req, res) => {
    if (req.get('x-requested-with') !== 'XmlHttpRequest') { res.sendStatus(403); return; }
    clear(res); res.json({ signedOut: true });
  });
  router.use((req, res, next) => {
    if (!configured) { res.status(503).json({ code: 'NOT_CONFIGURED', error: '此網站尚未啟用裝置長期登入，請使用 Google 重新連線。' }); return; }
    if (req.headers.origin !== origin || req.get('x-requested-with') !== 'XmlHttpRequest') {
      res.status(403).json({ code: 'INVALID_ORIGIN', error: '登入請求來源不符，請回到名片管家重試。' }); return;
    }
    next();
  });
  const exchange = async (parameters: Record<string, string>) => {
    const response = await request('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...parameters, client_id: clientId, client_secret: clientSecret! }),
      credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    const token = await response.json();
    if (!response.ok) {
      const error = new Error('Google 授權更新未完成。') as Error & { revoked?: boolean };
      error.revoked = response.status === 400 && token.error === 'invalid_grant';
      throw error;
    }
    if (typeof token.access_token !== 'string' || !token.access_token || !(Number(token.expires_in) > 0)) throw new Error('Invalid Google token response');
    return token;
  };
  router.post('/code', async (req, res) => {
    if (typeof req.body?.code !== 'string' || !req.body.code || req.body.code.length > 4096) {
      res.status(400).json({ error: '缺少有效的 Google 登入授權碼。' }); return;
    }
    try {
      const token = await exchange({ code: req.body.code, grant_type: 'authorization_code', redirect_uri: origin! });
      const profileResponse = await request('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token.access_token}` }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
      if (!profileResponse.ok) throw new Error('Google profile unavailable');
      const profile = await profileResponse.json();
      if (typeof profile.sub !== 'string' || typeof profile.email !== 'string' || profile.email_verified !== true) throw new Error('Google profile invalid');
      const previous = read(req);
      const refreshToken = typeof token.refresh_token === 'string' && token.refresh_token || (previous?.subject === profile.sub ? previous.refreshToken : null);
      if (refreshToken) save(res, { refreshToken, subject: profile.sub, email: profile.email, expiresAt: now() + MAX_AGE * 1000 });
      else clear(res);
      // Never return the refresh token, client secret, or cookie payload to JS.
      res.json({ access_token: token.access_token, expires_in: Number(token.expires_in), scope: token.scope, deviceRemembered: !!refreshToken });
    } catch {
      res.status(502).json({ code: 'AUTH_FAILED', error: 'Google 長期登入未完成，請重新連線或檢查網站登入設定。' });
    }
  });
  router.post('/session', async (req, res) => {
    const session = read(req);
    if (!session) { clear(res); res.status(401).json({ code: 'NO_SESSION', error: '請重新連線 Google。' }); return; }
    try {
      const token = await exchange({ refresh_token: session.refreshToken, grant_type: 'refresh_token' });
      save(res, { ...session, refreshToken: typeof token.refresh_token === 'string' && token.refresh_token || session.refreshToken, expiresAt: now() + MAX_AGE * 1000 });
      res.json({ access_token: token.access_token, expires_in: Number(token.expires_in), scope: token.scope, deviceRemembered: true, email: session.email });
    } catch (error) {
      const revoked = !!(error && typeof error === 'object' && 'revoked' in error && error.revoked);
      if (revoked) clear(res);
      res.status(revoked ? 401 : 503).json({ code: revoked ? 'SESSION_EXPIRED' : 'TEMPORARY_FAILURE', error: revoked ? 'Google 授權已失效，請重新連線。' : 'Google 連線暫時無法更新，稍後會再試。' });
    }
  });
  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: '登入請求格式不正確。' });
  });
  return router;
}
