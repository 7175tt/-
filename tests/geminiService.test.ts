import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getScanReadiness, scanBusinessCard, ScanRequestError } from '../services/geminiService';

const card = { name: '王小玲', company: '數位公司', title: '', phone: '', email: '', address: '', notes: '', rawText: '王小玲\n數位公司' };

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
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(input, '/api/gemini/status');
    assert.equal(init?.method, 'GET');
    return Response.json({ configured: false });
  });
  assert.deepEqual(await getScanReadiness(), { configured: false });
});
