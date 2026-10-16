import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createDrivePhotoRouter } from '../server/drivePhotoRoutes';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lGQAAAAASUVORK5CYII=', 'base64');

async function serve(t: TestContext, options: Parameters<typeof createDrivePhotoRouter>[0]) {
  const app = express();
  app.use('/api/drive', createDrivePhotoRouter(options));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/drive/public-photo`;
}

test('legacy public photo download uses only its Drive ID and forwards no browser credentials', async t => {
  const base = await serve(t, { fetch: async (url, options) => {
    assert.equal(String(url), 'https://drive.usercontent.google.com/uc?id=legacy-photo&export=download');
    assert.equal(options?.method, 'GET');
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.redirect, 'manual');
    assert.equal(options?.headers, undefined);
    assert.ok(options?.signal);
    return new Response(png, { headers: { 'content-type': 'application/octet-stream' } });
  } });
  const response = await fetch(`${base}/legacy-photo?url=https://example.invalid`, {
    headers: { Cookie: 'private-cookie', Authorization: 'Bearer private-token', 'x-gemini-api-key': 'private-key' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
});

test('private, missing, login and invalid-image responses never become usable photos', async t => {
  for (const reply of [
    () => new Response('', { status: 403 }), () => new Response('', { status: 404 }),
    () => new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('<html>not an image</html>', { headers: { 'content-type': 'image/jpeg' } }),
    () => new Response('', { status: 302, headers: { location: 'https://accounts.google.com/login' } }),
  ]) {
    const base = await serve(t, { fetch: async () => reply() });
    const response = await fetch(`${base}/unavailable`);
    assert.equal(response.status, 404);
    assert.match((await response.json()).error, /原始檔案與存取權/);
  }
});

test('redirects stay on Google photo hosts and cannot turn the endpoint into an arbitrary URL fetcher', async t => {
  for (const location of ['https://example.invalid/photo', 'http://lh3.googleusercontent.com/photo', 'https://lh3.googleusercontent.com.evil.invalid/photo', 'https://user:secret@lh3.googleusercontent.com/photo', 'https://lh3.googleusercontent.com:444/photo']) {
    let calls = 0;
    const base = await serve(t, { fetch: async () => { calls++; return new Response('', { status: 302, headers: { location } }); } });
    assert.equal((await fetch(`${base}/photo`)).status, 404);
    assert.equal(calls, 1);
  }
  let calls = 0;
  const base = await serve(t, { fetch: async (url, options) => {
    calls++;
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.headers, undefined);
    if (calls === 1) return new Response('', { status: 302, headers: { location: 'https://lh3.googleusercontent.com/photo' } });
    assert.equal(String(url), 'https://lh3.googleusercontent.com/photo');
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  } });
  assert.equal((await fetch(`${base}/photo`)).status, 200);
  assert.equal(calls, 2);
});

test('malformed photo IDs never reach Google', async t => {
  const base = await serve(t, { fetch: async () => { throw new Error('Must not fetch'); } });
  for (const id of ['https%3A%2F%2Fexample.invalid', 'photo.jpg', 'a'.repeat(201), 'a%3Fkey%3Dx']) {
    assert.equal((await fetch(`${base}/${id}`)).status, 400);
  }
});

test('oversized bodies are rejected with and without content-length', async t => {
  for (const declared of [true, false]) {
    const base = await serve(t, { maxBytes: 32, fetch: async () => new Response(png, {
      headers: { 'content-type': 'image/png', ...(declared ? { 'content-length': String(png.length) } : {}) },
    }) });
    assert.equal((await fetch(`${base}/photo`)).status, 413);
  }
});

test('slow requests time out and internal errors do not leak response details', async t => {
  const slow = await serve(t, { timeoutMs: 10, fetch: async (_url, options) => new Promise<Response>((_resolve, reject) => {
    options!.signal!.addEventListener('abort', () => reject(new Error('secret upstream context')));
  }) });
  assert.equal((await fetch(`${slow}/photo`)).status, 504);
  const broken = await serve(t, { fetch: async () => { throw new Error('secret upstream context'); } });
  const response = await fetch(`${broken}/photo`);
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('secret upstream context'));
});
