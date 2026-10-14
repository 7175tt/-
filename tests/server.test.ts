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
const personalKey = 'Synthetic_personal_key_for_tests_only_01';
const ownerKey = 'Synthetic_shared_key_for_tests_only_02';

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
    get: (path: string, headers: Record<string, string> = {}) => fetch(`${url}/${path}`, { headers }),
    post: (path: string, body: unknown, key: string | null = personalKey) => fetch(`${url}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key === null ? {} : { 'x-gemini-api-key': key }) },
      body: JSON.stringify(body),
    }),
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
    allowSharedKey: false,
    sharedApiKey: ownerKey,
    getClient: () => { throw new Error('Readiness must not initialize the AI client'); },
  });
  const response = await api.get('status');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { configured: false, personalKeySupported: true });
});

test('server key is not used without explicit shared-key opt-in', async t => {
  const api = await serve(t, {
    sharedApiKey: ownerKey,
    allowSharedKey: false,
    getClient: () => { throw new Error('Owner key must not be used'); },
  });
  const response = await api.post('scan', { base64Image: image }, null);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'API_KEY_REQUIRED');
});

test('shared key is disabled by default when the opt-in environment flag is unset', async t => {
  if (process.env.ALLOW_SHARED_GEMINI_KEY !== undefined) return t.skip('Runtime explicitly configures the shared-key flag');
  const api = await serve(t, {
    sharedApiKey: ownerKey,
    getClient: () => { throw new Error('Default configuration must not spend the owner quota'); },
  });
  assert.deepEqual(await (await api.get('status')).json(), { configured: false, personalKeySupported: true });
  assert.equal((await api.post('scan', { base64Image: image }, null)).status, 401);
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
  for (const [providerStatus, status, code] of [[429, 429, 'RATE_LIMITED'], [403, 403, 'INVALID_API_KEY'], [500, 502, 'SCAN_FAILED']] as const) {
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
    headers: { 'Content-Type': 'application/json', 'x-gemini-api-key': personalKey },
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

test('personal keys remain isolated across overlapping requests and override opted-in shared credentials', async t => {
  const secondKey = 'Synthetic_second_personal_key_for_tests_03';
  const receivedKeys: string[] = [];
  const receivedRequests: GenerateContentParameters[] = [];
  let releaseFirst!: () => void;
  const firstHeld = new Promise<void>(resolve => { releaseFirst = resolve; });
  const api = await serve(t, {
    sharedApiKey: ownerKey,
    allowSharedKey: true,
    getClient: key => {
      receivedKeys.push(key);
      return stubClient(async request => {
        receivedRequests.push(request);
        if (key === personalKey) await firstHeld;
        else releaseFirst();
        return { text: JSON.stringify({ ...card, name: key === personalKey ? 'First user' : 'Second user' }) };
      });
    },
  });
  const [first, second] = await Promise.all([
    api.post('scan', { base64Image: image }, personalKey),
    api.post('scan', { base64Image: image }, secondKey),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await first.json()).structuredData.name, 'First user');
  assert.equal((await second.json()).structuredData.name, 'Second user');
  assert.deepEqual(receivedKeys.sort(), [personalKey, secondKey].sort());
  assert.ok(!receivedKeys.includes(ownerKey));
  assert.ok(!JSON.stringify(receivedRequests).includes(personalKey));
  assert.ok(!JSON.stringify(receivedRequests).includes(secondKey));
});

test('malformed personal keys never fall back to the opted-in server key', async t => {
  let calls = 0;
  const api = await serve(t, {
    sharedApiKey: ownerKey,
    allowSharedKey: true,
    getClient: () => { calls++; return stubClient(async () => ({ text: JSON.stringify(card) })); },
  });
  for (const key of ['', 'too-short', 'invalid key has spaces', 'A'.repeat(257), 'A'.repeat(513), `${personalKey},${ownerKey}`]) {
    const response = await api.post('scan', { base64Image: image }, key);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'INVALID_API_KEY');
  }
  for (const [path, body] of [
    [`scan?apiKey=${personalKey}`, { base64Image: image }],
    ['scan', { base64Image: image, apiKey: personalKey }],
  ] as const) {
    const response = await api.post(path, body, null);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'INVALID_REQUEST');
  }
  assert.equal(calls, 0);
});

test('shared key can be used only after opt-in and readiness never returns a key', async t => {
  const used: string[] = [];
  const api = await serve(t, {
    sharedApiKey: ownerKey,
    allowSharedKey: true,
    getClient: key => { used.push(key); return stubClient(async () => ({ text: JSON.stringify(card) })); },
  });
  const status = await api.get('status');
  assert.deepEqual(await status.json(), { configured: true, personalKeySupported: true });
  const statusWithPersonalHeader = await api.get('status', { 'x-gemini-api-key': personalKey });
  assert.deepEqual(await statusWithPersonalHeader.json(), { configured: true, personalKeySupported: true });
  assert.equal(used.length, 0);
  const response = await api.post('scan', { base64Image: image }, null);
  assert.equal(response.status, 200);
  assert.deepEqual(used, [ownerKey]);
  const noServerKey = await serve(t, { allowSharedKey: true, sharedApiKey: '' });
  assert.deepEqual(await (await noServerKey.get('status')).json(), { configured: false, personalKeySupported: true });
});

test('key check makes a minimal generate request with the personal key and configured model', async t => {
  const calls: GenerateContentParameters[] = [];
  const api = await serve(t, {
    sharedApiKey: ownerKey,
    allowSharedKey: true,
    model: 'selected-model-for-scanning',
    getClient: key => {
      assert.equal(key, personalKey);
      return stubClient(async request => { calls.push(request); return { text: 'OK' }; });
    },
  });
  const response = await api.post('check-key', {}, `  ${personalKey}  `);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { valid: true, model: 'selected-model-for-scanning' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'selected-model-for-scanning');
  assert.equal(calls[0].contents, 'Reply with OK.');
  assert.ok(calls[0].config!.maxOutputTokens! <= 8);
  assert.ok(calls[0].config?.abortSignal);
  const missing = await api.post('check-key', {}, null);
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).code, 'API_KEY_REQUIRED');
  assert.equal(calls.length, 1, 'Checking a personal key must never use the server key');
});

test('key check distinguishes invalid credentials, quota, unavailable model, and safe provider failures', async t => {
  for (const [providerStatus, message, expectedStatus, code] of [
    [401, 'Unauthorized', 403, 'INVALID_API_KEY'],
    [403, 'Forbidden', 403, 'INVALID_API_KEY'],
    [400, '{"reason":"API_KEY_INVALID"}', 403, 'INVALID_API_KEY'],
    [429, 'quota exhausted', 429, 'RATE_LIMITED'],
    [404, 'model missing', 503, 'MODEL_UNAVAILABLE'],
    [500, 'provider failed', 502, 'SCAN_FAILED'],
  ] as const) {
    const api = await serve(t, { getClient: () => stubClient(async () => {
      throw Object.assign(new Error(`${message} ${personalKey}`), { status: providerStatus });
    }) });
    const response = await api.post('check-key', {});
    assert.equal(response.status, expectedStatus);
    const result = await response.json();
    assert.equal(result.code, code);
    assert.ok(!JSON.stringify(result).includes(personalKey));
  }
});

test('successful provider responses cannot reflect a personal key into contact data', async t => {
  const api = await serve(t, { getClient: key => stubClient(async () => ({ text: JSON.stringify({ ...card, notes: `Accidental echo: ${key}` }) })) });
  for (const path of ['scan', 'extract', 'structure', 'check-key']) {
    const response = await api.post(path, path === 'structure' ? { rawText: '聯絡資料' } : { base64Image: image });
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.equal(result.code, 'INVALID_RESPONSE');
    assert.ok(!JSON.stringify(result).includes(personalKey));
  }
});
