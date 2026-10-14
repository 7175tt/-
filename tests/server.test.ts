import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { GenerateContentParameters } from '@google/genai';
import { createGeminiRouter, MAX_IMAGE_BYTES, MAX_TEXT_LENGTH, parseImage, type GeminiClient } from '../server/geminiRoutes';

const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lGQAAAAASUVORK5CYII=', 'base64');
const image = `data:image/png;base64,${imageBytes.toString('base64')}`;
const card = { name: '陳小明', company: '測試公司', title: '設計師', phone: '+886 2 1234 5678 #9', email: 'ming@example.com', address: '', notes: 'https://example.com', rawText: '陳小明\n測試公司\n設計師\n+886 2 1234 5678 #9\nming@example.com' };

async function serve(t: TestContext, options: Parameters<typeof createGeminiRouter>[0]) {
  const app = express();
  app.use('/api/gemini', createGeminiRouter(options));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/gemini`;
  return {
    get: (path: string) => fetch(`${url}/${path}`),
    post: (path: string, body: unknown) => fetch(`${url}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    url,
  };
}

function stubClient(generateContent: GeminiClient['models']['generateContent']): GeminiClient {
  return { models: { generateContent } };
}

test('scan extracts fields and original text with exactly one image request', async t => {
  const calls: GenerateContentParameters[] = [];
  const api = await serve(t, {
    getClient: () => stubClient(async request => {
      calls.push(request);
      return { text: JSON.stringify({ ...card, unexpected: 'discard me' }) };
    }),
    model: 'configured-test-model',
  });
  const response = await api.post('scan', { base64Image: image });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { structuredData: card });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'configured-test-model');
  assert.deepEqual((calls[0].contents as { parts: unknown[] }).parts[0], { inlineData: { mimeType: 'image/png', data: imageBytes.toString('base64') } });
  assert.ok((calls[0].config?.responseSchema as { required: string[] }).required.includes('rawText'));
  assert.ok(calls[0].config?.abortSignal);
});

test('invalid images never reach the model', async t => {
  let calls = 0;
  const api = await serve(t, { getClient: () => stubClient(async () => { calls++; return { text: '{}' }; }) });
  for (const base64Image of [null, {}, 42, '', 'not base64', 'data:image/png;base64,AAAA', image.replace('image/png', 'image/jpeg')]) {
    const response = await api.post('scan', { base64Image });
    assert.ok([400, 415].includes(response.status));
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.equal(calls, 0);
});

test('image validation infers the actual format for legacy raw base64 and rejects oversized payloads', () => {
  assert.equal(parseImage(imageBytes.toString('base64')).mimeType, 'image/png');
  assert.throws(() => parseImage('A'.repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 101)), { code: 'IMAGE_TOO_LARGE', status: 413 });
  assert.throws(() => parseImage('data:image/png;base64,AB=='), { code: 'INVALID_IMAGE', status: 400 });
});

test('readiness reports only configured presence without making an AI request', async t => {
  const api = await serve(t, {
    isConfigured: () => false,
    getClient: () => { throw new Error('Readiness must not initialize the AI client'); },
  });
  const response = await api.get('status');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { configured: false });
});

test('missing key has an actionable response and does not crash the API', async t => {
  if (process.env.GEMINI_API_KEY?.trim()) return t.skip('An existing server credential is configured');
  const api = await serve(t, {});
  const response = await api.post('scan', { base64Image: image });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'NOT_CONFIGURED');
});

test('malformed JSON and a missing body return a JSON client error', async t => {
  const api = await serve(t, { getClient: () => { throw new Error('Must not call the provider'); } });
  const response = await fetch(`${api.url}/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'INVALID_REQUEST');
  const missing = await fetch(`${api.url}/scan`, { method: 'POST' });
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).code, 'INVALID_IMAGE');
});

test('unreadable and malformed model results do not create blank contact records', async t => {
  for (const [text, status, code] of [
    ['', 422, 'NO_TEXT'],
    ['{}', 422, 'NO_TEXT'],
    ['not json', 502, 'INVALID_RESPONSE'],
    ['[]', 502, 'INVALID_RESPONSE'],
    ['{"name":42}', 502, 'INVALID_RESPONSE'],
  ] as const) {
    const api = await serve(t, { getClient: () => stubClient(async () => ({ text })) });
    const response = await api.post('scan', { base64Image: image });
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, code);
  }
});

test('provider errors never expose provider messages or secret-like data', async t => {
  for (const [providerStatus, status, code] of [[429, 429, 'RATE_LIMITED'], [403, 503, 'SERVICE_UNAVAILABLE'], [500, 502, 'SCAN_FAILED']] as const) {
    const api = await serve(t, {
      getClient: () => stubClient(async () => { throw Object.assign(new Error('private-key-value and personal data'), { status: providerStatus }); }),
    });
    const response = await api.post('scan', { base64Image: image });
    const data = await response.json();
    assert.equal(response.status, status);
    assert.equal(data.code, code);
    assert.ok(!JSON.stringify(data).includes('private-key-value'));
    if (providerStatus === 429) assert.equal(response.headers.get('retry-after'), '30');
  }
});

test('a stalled provider request times out and aborts its SDK signal', async t => {
  let signal: AbortSignal | undefined;
  const api = await serve(t, {
    timeoutMs: 15,
    getClient: () => stubClient(async request => {
      signal = request.config?.abortSignal;
      return new Promise(() => {});
    }),
  });
  const response = await api.post('scan', { base64Image: image });
  assert.equal(response.status, 504);
  assert.equal((await response.json()).code, 'SCAN_TIMEOUT');
  assert.equal(signal?.aborted, true);
});

test('client disconnect cancels the in-flight SDK request', async t => {
  let started!: () => void;
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  let cancelled!: () => void;
  const requestCancelled = new Promise<void>(resolve => { cancelled = resolve; });
  const api = await serve(t, {
    timeoutMs: 1000,
    getClient: () => stubClient(async request => {
      request.config?.abortSignal?.addEventListener('abort', cancelled, { once: true });
      started();
      return new Promise(() => {});
    }),
  });
  const controller = new AbortController();
  const pending = fetch(`${api.url}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Image: image }),
    signal: controller.signal,
  });
  await requestStarted;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await requestCancelled;
});

test('legacy extract and structure endpoints still work and preserve source text', async t => {
  let calls = 0;
  const api = await serve(t, { getClient: () => stubClient(async () => ({ text: ++calls === 1 ? '原始文字' : JSON.stringify(card) })) });
  const extracted = await api.post('extract', { base64Image: image });
  assert.deepEqual(await extracted.json(), { text: '原始文字' });
  const structured = await api.post('structure', { rawText: '原始文字' });
  assert.deepEqual(await structured.json(), { structuredData: { ...card, rawText: '原始文字' } });
  for (const [rawText, expectedStatus] of [[null, 400], ['', 400], [{ text: 'wrong shape' }, 400], ['A'.repeat(MAX_TEXT_LENGTH + 1), 413]] as const) {
    assert.equal((await api.post('structure', { rawText })).status, expectedStatus);
  }
  assert.equal(calls, 2);
});
