import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { checkGeminiApiKey, getScanReadiness, scanBusinessCard, ScanRequestError } from '../services/geminiService';
import { clearGeminiApiKey, getGeminiKeySettings, saveGeminiApiKey } from '../services/geminiKeySettings';

const card = { name: '王小玲', company: '數位公司', title: '', phone: '', email: '', address: '', notes: '', rawText: '王小玲\n數位公司' };
const personalKey = 'synthetic-personal-key-1234567890';
const otherKey = 'synthetic-second-key-1234567890';

function withKeyStorage(t: TestContext) {
  const storage = () => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { sessionStorage: storage(), localStorage: storage() } });
  t.after(() => {
    clearGeminiApiKey();
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  });
}

test('client uses one scan call and preserves complete structured data', async t => {
  const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return Response.json({ structuredData: card });
  });
  assert.deepEqual(await scanBusinessCard('image-data'), card);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, '/api/gemini/scan');
  assert.deepEqual(JSON.parse(calls[0].init?.body as string), { base64Image: 'image-data' });
});

test('client keeps server retry errors actionable', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: '稍後再試', code: 'RATE_LIMITED' }, { status: 429 }));
  await assert.rejects(scanBusinessCard('image-data'), error => error instanceof ScanRequestError && error.code === 'RATE_LIMITED' && error.status === 429 && error.message === '稍後再試');
});

test('client rejects malformed success responses instead of saving missing fields', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ structuredData: { name: 'missing fields' } }));
  await assert.rejects(scanBusinessCard('image-data'), { code: 'INVALID_RESPONSE' });
});

test('client converts network failures and supports user cancellation', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(scanBusinessCard('image-data'), { code: 'NETWORK_ERROR' });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(scanBusinessCard('image-data', controller.signal), { name: 'AbortError' });
});

test('readiness uses GET and validates the configuration flag', async t => {
  withKeyStorage(t);
  saveGeminiApiKey(personalKey);
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(input, '/api/gemini/status');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.headers, undefined);
    assert.equal(init?.body, undefined);
    return Response.json({ configured: false });
  });
  assert.deepEqual(await getScanReadiness(), { configured: false });
});

test('personal credentials stay in request headers and are captured separately for overlapping scans', async t => {
  withKeyStorage(t);
  const requests: RequestInit[] = [];
  const replies: Array<(response: Response) => void> = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(input, '/api/gemini/scan');
    requests.push(init!);
    return new Promise<Response>(resolve => replies.push(resolve));
  });
  saveGeminiApiKey(personalKey);
  const first = scanBusinessCard('first-image');
  saveGeminiApiKey(otherKey);
  const second = scanBusinessCard('second-image');
  assert.equal(new Headers(requests[0].headers).get('x-gemini-api-key'), personalKey);
  assert.equal(new Headers(requests[1].headers).get('x-gemini-api-key'), otherKey);
  for (const request of requests) {
    assert.equal(request.redirect, 'error');
    assert.equal(request.cache, 'no-store');
    assert.equal(String(request.body).includes('key'), false);
  }
  replies.forEach(resolve => resolve(Response.json({ structuredData: card })));
  assert.deepEqual(await Promise.all([first, second]), [card, card]);
});

test('checking a draft uses that key without saving or replacing the scan key', async t => {
  withKeyStorage(t);
  saveGeminiApiKey(personalKey);
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(input, '/api/gemini/check-key');
    assert.equal(new Headers(init?.headers).get('x-gemini-api-key'), otherKey);
    assert.equal(init?.body, '{}');
    return Response.json({ valid: true, model: 'mock-model' });
  });
  assert.deepEqual(await checkGeminiApiKey(` ${otherKey} `), { valid: true, model: 'mock-model' });
  assert.equal(getGeminiKeySettings().apiKey, personalKey);
});

test('invalid draft keys are rejected before a request or shared-key fallback', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ valid: true, model: 'mock' }); });
  for (const key of ['', 'short', `${personalKey}\nheader: bad`]) {
    await assert.rejects(checkGeminiApiKey(key), { code: 'INVALID_API_KEY' });
  }
  assert.equal(calls, 0);
});

test('provider rejection does not retry without the personal key or expose echoed credentials', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ error: `Rejected ${personalKey}`, code: 'INVALID_API_KEY' }, { status: 403 });
  });
  await assert.rejects(checkGeminiApiKey(personalKey), error => error instanceof ScanRequestError
    && error.code === 'INVALID_API_KEY' && !error.message.includes(personalKey));
  assert.equal(calls, 1);
});

test('personal keys cannot be sent from an unencrypted remote website', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { protocol: 'http:', hostname: 'example.test' } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'location', original);
    else Reflect.deleteProperty(globalThis, 'location');
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ valid: true, model: 'mock' }); });
  await assert.rejects(checkGeminiApiKey(personalKey), { code: 'HTTPS_REQUIRED' });
  assert.equal(calls, 0);
});
