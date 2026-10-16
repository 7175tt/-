import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createGoogleSessionRouter } from '../server/googleSessionRoutes';

const config = { clientId: 'synthetic-client.apps.googleusercontent.com', clientSecret: 'synthetic-client-secret', sessionSecret: 'synthetic-encryption-key-with-at-least-32-characters', origin: 'https://cards.example.invalid' };
const profile = { sub: 'subject-a', email: 'a@example.invalid', email_verified: true };
const refresh = 'synthetic-refresh-secret';
async function serve(t: TestContext, options: Parameters<typeof createGoogleSessionRouter>[0]) {
  const app = express(); app.use('/api/google', createGoogleSessionRouter(options));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/google`;
  return {
    get: () => fetch(`${base}/status`),
    post: (path: string, body: unknown = {}, cookie = '', headers = { Origin: config.origin, 'X-Requested-With': 'XmlHttpRequest' }) => fetch(`${base}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
    }),
  };
}
function provider(overrides: { noRefresh?: boolean; subject?: string; fail?: boolean } = {}): typeof fetch {
  return async (url, options) => {
    assert.equal(options?.redirect, 'error');
    assert.equal(options?.credentials, 'omit');
    if (String(url).includes('/userinfo')) return Response.json({ ...profile, ...(overrides.subject ? { sub: overrides.subject, email: 'b@example.invalid' } : {}) });
    assert.equal(String(url), 'https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(String(options?.body));
    assert.equal(body.get('client_secret'), config.clientSecret);
    if (body.get('grant_type') === 'authorization_code') {
      assert.equal(body.get('redirect_uri'), config.origin);
      assert.equal(body.get('code'), 'synthetic-code');
    } else assert.equal(body.get('refresh_token'), refresh);
    if (overrides.fail) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    return Response.json({ access_token: 'synthetic-short-access', expires_in: 3600, ...(overrides.noRefresh ? {} : { refresh_token: refresh }) });
  };
}

test('long-lived login configuration reports readiness without exposing secrets', async t => {
  const disabled = await serve(t, { ...config, clientSecret: '', fetch: provider() });
  assert.deepEqual(await (await disabled.get()).json(), { persistentConfigured: false });
  const enabled = await serve(t, { ...config, fetch: provider() });
  const response = await enabled.get();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { persistentConfigured: true, clientId: config.clientId });
});

test('code exchange seals the refresh token in a Secure HttpOnly host-only cookie', async t => {
  const api = await serve(t, { ...config, fetch: provider() });
  const response = await api.post('code', { code: 'synthetic-code' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).deviceRemembered, true);
  const cookie = response.headers.get('set-cookie')!;
  for (const attribute of ['__Host-keeper_google_session=', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(cookie.includes(attribute));
  assert.ok(!cookie.includes('Domain='));
  assert.ok(!cookie.includes(refresh) && !cookie.includes(config.clientSecret) && !cookie.includes(profile.email));
  const restarted = await serve(t, { ...config, fetch: provider() });
  const renewed = await restarted.post('session', {}, cookie.split(';')[0]);
  assert.equal(renewed.status, 200);
  const text = await renewed.text();
  assert.ok(text.includes('synthetic-short-access') && !text.includes(refresh) && !text.includes(config.clientSecret));
});

test('OAuth exchange and refresh reject cross-origin and missing custom-header requests before contacting Google', async t => {
  let calls = 0;
  const api = await serve(t, { ...config, fetch: async () => { calls++; throw new Error('Must not contact Google'); } });
  for (const path of ['code', 'session']) {
    assert.equal((await api.post(path, { code: 'synthetic-code' }, '', { Origin: 'https://other.example.invalid', 'X-Requested-With': 'XmlHttpRequest' })).status, 403);
    assert.equal((await api.post(path, { code: 'synthetic-code' }, '', { Origin: config.origin, 'X-Requested-With': '' })).status, 403);
  }
  assert.equal(calls, 0);
});

test('tampered, expired and wrong-key cookies cannot obtain access tokens', async t => {
  const api = await serve(t, { ...config, now: () => 1000, fetch: provider() });
  const response = await api.post('code', { code: 'synthetic-code' });
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  const parts = cookie.split('='); parts[1] = `${parts[1][0] === 'A' ? 'B' : 'A'}${parts[1].slice(1)}`;
  assert.equal((await api.post('session', {}, parts.join('='))).status, 401);
  const expired = await serve(t, { ...config, now: () => 1000 + 91 * 24 * 3600_000, fetch: provider() });
  assert.equal((await expired.post('session', {}, cookie)).status, 401);
  const changedKey = await serve(t, { ...config, sessionSecret: 'a-different-synthetic-key-with-32-characters', fetch: provider() });
  assert.equal((await changedKey.post('session', {}, cookie)).status, 401);
});

test('revoked refresh credentials are cleared while temporary failures retain the device session', async t => {
  const api = await serve(t, { ...config, fetch: provider() });
  const cookie = (await api.post('code', { code: 'synthetic-code' })).headers.get('set-cookie')!.split(';')[0];
  const revoked = await serve(t, { ...config, fetch: provider({ fail: true }) });
  const denial = await revoked.post('session', {}, cookie);
  assert.equal(denial.status, 401); assert.ok(denial.headers.get('set-cookie')?.includes('Expires='));
  const broken = await serve(t, { ...config, fetch: async () => { throw new Error(`Provider error contains ${refresh}`); } });
  const temporary = await broken.post('session', {}, cookie);
  assert.equal(temporary.status, 503); assert.equal(temporary.headers.get('set-cookie'), null);
  assert.ok(!(await temporary.text()).includes(refresh));
});

test('a new account cannot reuse the previous account refresh credentials', async t => {
  const api = await serve(t, { ...config, fetch: provider() });
  const cookie = (await api.post('code', { code: 'synthetic-code' })).headers.get('set-cookie')!.split(';')[0];
  const accountB = await serve(t, { ...config, fetch: provider({ subject: 'subject-b', noRefresh: true }) });
  const response = await accountB.post('code', { code: 'synthetic-code' }, cookie);
  assert.equal((await response.json()).deviceRemembered, false);
  assert.ok(response.headers.get('set-cookie')?.includes('Expires='));
});

test('logout clears the cookie even if persistent login is disabled later', async t => {
  const api = await serve(t, { ...config, clientSecret: '' });
  const response = await api.post('logout');
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('set-cookie')?.includes('Expires='));
});
