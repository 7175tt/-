import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import * as api from '../services/googleApiService';
import { CARD_SHEET_NAME } from '../config';
import type { BusinessCard } from '../types';

const headers = ['id', 'name', 'company', 'title', 'phone', 'email', 'address', 'notes', 'timestamp', 'imageDriveId', 'rawText'];
const makeCard = (id: string, overrides: Partial<BusinessCard> = {}): BusinessCard => ({
  id, name: id, company: '公司', title: '工程師', phone: '0912345678', email: 'person@example.com',
  address: '台北', notes: '', rawText: '產品／研發', timestamp: 100, ...overrides,
});
const toRow = (card: BusinessCard) => headers.map(header => (card as any)[header] ?? '');
let rows: unknown[][];
let events: Array<{ type: string; args: any }>;
let images: Array<{ id: string; name: string }>;
let token: { access_token: string } | null;
let failDelete: any;
let failAppendAfterCommit: boolean;
let createStorage: boolean;
let listOverride: ((args: any) => any) | undefined;
let globals: any;
const originalFetch = globalThis.fetch;

test('photo downloads report expired login, missing permission and unavailable files', async () => {
  for (const [status, message] of [[401, /登入已到期/], [403, /沒有這張照片的存取權/], [404, /找不到雲端照片/]] as const) {
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /\/drive\/v3\/files\/private-photo\?alt=media$/);
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-only');
      assert.ok(init?.signal, 'An unresponsive download must time out');
      return new Response('{}', { status });
    };
    await assert.rejects(api.getImageAsBase64('private-photo'), message);
  }
});

test('an account change during photo download discards the previous account response', async () => {
  let respond!: (response: Response) => void;
  globalThis.fetch = () => new Promise<Response>(resolve => { respond = resolve; });
  const pending = api.getImageAsBase64('private-photo');
  api.signOut();
  token = { access_token: 'other-account' };
  respond(new Response('image bytes', { headers: { 'Content-Type': 'image/jpeg' } }));
  await assert.rejects(pending, /Google 帳號已變更/);
});

test('an empty photo response is not cached as a usable image', async () => {
  globalThis.fetch = async () => new Response('', { headers: { 'Content-Type': 'image/jpeg' } });
  await assert.rejects(api.getImageAsBase64('empty-photo'), /照片內容為空/);
});

beforeEach(() => {
  api.signOut();
  rows = [headers, toRow(makeCard('first')), toRow(makeCard('second')), toRow(makeCard('last'))];
  events = [];
  images = [{ id: 'image-first', name: 'first.jpg' }, { id: 'image-second', name: 'second.jpg' }];
  token = { access_token: 'test-only' };
  failDelete = null;
  failAppendAfterCommit = false;
  createStorage = false;
  listOverride = undefined;
  globals = {
    load: (_name: string, options: any) => options.callback(),
    client: {
      init: async () => {}, getToken: () => token, setToken: (next: any) => { token = next; },
      drive: {
        files: {
          list: async (args: any) => {
            events.push({ type: 'list', args });
            if (listOverride) { const override = listOverride(args); if (override) return override; }
            if (args.q.includes("mimeType='application/vnd.google-apps.spreadsheet'")) return { result: { files: createStorage ? [] : [{ id: 'spreadsheet' }] } };
            if (args.q.includes("mimeType='application/vnd.google-apps.folder'")) return { result: { files: createStorage ? [] : [{ id: 'folder' }] } };
            const name = args.q.match(/name='([^']+)'/)?.[1];
            const prefix = args.q.match(/name contains '([^']+)'/)?.[1];
            return { result: { files: images.filter(file => file.name === name || (prefix && file.name.startsWith(prefix))) } };
          },
          create: async (args: any) => { events.push({ type: 'folder-create', args }); return { result: { id: 'folder' } }; },
          delete: async (args: any) => { events.push({ type: 'image-delete', args }); images = images.filter(file => file.id !== args.fileId); },
        },
        permissions: { create: async () => { throw new Error('Photos must never become public.'); } },
      },
      sheets: { spreadsheets: {
        create: async (args: any) => { events.push({ type: 'sheet-create', args }); rows = []; return { result: { spreadsheetId: 'spreadsheet' } }; },
        get: async () => ({ result: { sheets: [{ properties: { title: CARD_SHEET_NAME, sheetId: 17 } }] } }),
        values: {
          get: async (args: any) => {
            events.push({ type: 'get', args });
            if (args.range.endsWith('!K1')) return { result: { values: rows[0]?.[10] ? [[rows[0][10]]] : [] } };
            assert.match(args.range, /!A2:K$/);
            return { result: { values: rows.slice(1).map(row => [...row]) } };
          },
          update: async (args: any) => {
            events.push({ type: 'update', args });
            if (args.range.endsWith('!K1')) { rows[0] ??= []; rows[0][10] = args.resource.values[0][0]; }
            else {
              const rowNumber = Number(args.range.match(/!A(\d+)/)?.[1]);
              assert.ok(rowNumber > 0);
              rows[rowNumber - 1] = [...args.resource.values[0]];
            }
          },
          append: async (args: any) => {
            events.push({ type: 'append', args }); rows.push(...args.resource.values.map((row: unknown[]) => [...row]));
            if (failAppendAfterCommit) { failAppendAfterCommit = false; throw { status: 503, result: { error: { message: 'Response lost' } } }; }
          },
        },
        batchUpdate: async (args: any) => {
          events.push({ type: 'sheet-delete', args });
          if (failDelete) throw failDelete;
          for (const request of args.resource.requests) {
            const range = request.deleteDimension.range;
            assert.equal(range.sheetId, 17);
            rows.splice(range.startIndex, range.endIndex - range.startIndex);
          }
        },
      } },
    },
  };
  (globalThis as any).gapi = globals;
});

afterEach(() => {
  api.signOut();
  globalThis.fetch = originalFetch;
  delete (globalThis as any).document;
  delete (globalThis as any).google;
});

test('updating first, middle, and last cards changes exactly their sheet rows', async () => {
  for (const id of ['first', 'second', 'last']) await api.updateCardInSheet(makeCard(id, { name: `Edited ${id}`, timestamp: 200 }));
  assert.deepEqual(rows[0], headers);
  assert.deepEqual(rows.slice(1).map(row => row[1]), ['Edited first', 'Edited second', 'Edited last']);
  assert.deepEqual(events.filter(event => event.type === 'update').map(event => event.args.range), [
    `'${CARD_SHEET_NAME}'!A2:K2`, `'${CARD_SHEET_NAME}'!A3:K3`, `'${CARD_SHEET_NAME}'!A4:K4`,
  ]);
});

test('deleting first, middle, and last cards preserves the header and all other rows', async () => {
  for (const id of ['second', 'first', 'last']) await api.deleteCardFromSheet(id);
  assert.deepEqual(rows, [headers]);
  assert.deepEqual(events.filter(event => event.type === 'sheet-delete').map(event => event.args.resource.requests[0].deleteDimension.range.startIndex), [2, 1, 1]);
  assert.ok(events.findIndex(event => event.type === 'sheet-delete') < events.findIndex(event => event.type === 'image-delete'));
});

test('a failed sheet deletion keeps photos intact and reports the Google error', async () => {
  failDelete = { status: 403, result: { error: { message: 'Permission denied' } } };
  await assert.rejects(api.deleteCardFromSheet('first'), /Permission denied/);
  assert.equal(rows.length, 4);
  assert.equal(images.length, 2);
  assert.equal(events.filter(event => event.type === 'image-delete').length, 0);
  failDelete = null;
  await api.deleteCardFromSheet('first');
  assert.deepEqual(rows.slice(1).map(row => row[0]), ['second', 'last']);
});

test('duplicate historic rows are removed from bottom to top and deletion retries are safe', async () => {
  rows.push(toRow(makeCard('first')));
  await api.deleteCardFromSheet('first');
  await api.deleteCardFromSheet('first');
  assert.deepEqual(rows.slice(1).map(row => row[0]), ['second', 'last']);
  const request = events.find(event => event.type === 'sheet-delete')!.args.resource.requests;
  assert.deepEqual(request.map((entry: any) => entry.deleteDimension.range.startIndex), [4, 1]);
  assert.equal(events.filter(event => event.type === 'sheet-delete').length, 1);
});

test('concurrent operations create storage only once and serialize identical ID upserts', async () => {
  createStorage = true;
  await Promise.all([
    api.prepareCloudStorage(), api.prepareCloudStorage(),
    api.addCardsToSheet([makeCard('new')]), api.addCardsToSheet([makeCard('new', { timestamp: 200, name: 'Newest' })]),
  ]);
  assert.equal(events.filter(event => event.type === 'sheet-create').length, 1);
  assert.equal(events.filter(event => event.type === 'folder-create').length, 1);
  assert.equal(events.filter(event => event.type === 'append').length, 1);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][1], 'Newest');
});

test('retry after an append commits but its response is lost does not duplicate cards', async () => {
  failAppendAfterCommit = true;
  await assert.rejects(api.addCardsToSheet([makeCard('new')]), /Response lost/);
  await api.addCardsToSheet([makeCard('new')]);
  assert.equal(rows.filter(row => row[0] === 'new').length, 1);
  assert.equal(events.filter(event => event.type === 'append').length, 1);
});

test('an old retry cannot overwrite a newer remote edit; repeated batch IDs are deduplicated', async () => {
  rows[1] = toRow(makeCard('first', { timestamp: 500, name: 'Remote edit' }));
  await api.addCardsToSheet([makeCard('first'), makeCard('new'), makeCard('new', { timestamp: 300, name: 'Latest batch edit' })]);
  assert.equal(rows[1][1], 'Remote edit');
  assert.equal(rows.filter(row => row[0] === 'new').length, 1);
  assert.equal(rows.at(-1)?.[1], 'Latest batch edit');
});

test('legacy A:J data retains column positions and OCR text round-trips in column K', async () => {
  rows = [headers.slice(0, 10), toRow(makeCard('old', { imageDriveId: 'image-old' })).slice(0, 10)];
  const before = await api.getCloudCardsLight();
  assert.equal(before.cards[0].imageDriveId, 'image-old');
  assert.equal(before.cards[0].rawText, '');
  await api.updateCardInSheet(makeCard('old', { imageDriveId: 'image-old', rawText: '機器視覺 AI\n分機 123' }));
  const after = await api.getCloudCardsLight();
  assert.equal(after.cards[0].rawText, '機器視覺 AI\n分機 123');
  assert.deepEqual(rows[0], headers);
  assert.equal(rows[1][9], 'image-old');
});

test('blank rows are ignored and invalid dates stay older than actual edits', async () => {
  const badDate = toRow(makeCard('bad-date')); badDate[8] = 'not-a-date';
  rows.push([], badDate);
  const result = await api.getCloudCardsLight();
  assert.equal(result.cards.length, 4);
  assert.equal(result.cards.find(card => card.id === 'bad-date')?.timestamp, 0);
});

test('an existing custom K column is preserved and reports a clear setup error', async () => {
  rows[0] = [...headers.slice(0, 10), 'custom'];
  await assert.rejects(api.prepareCloudStorage(), /K 欄/);
  assert.equal(rows[0][10], 'custom');
  rows[0][10] = 'rawText';
  await api.prepareCloudStorage();
});

test('Drive lookups follow pagination before creating a spreadsheet', async () => {
  listOverride = args => args.q.includes('spreadsheet') ? {
    result: args.pageToken ? { files: [{ id: 'spreadsheet' }] } : { files: [], nextPageToken: 'page-two' },
  } : null;
  await api.prepareCloudStorage();
  assert.equal(events.filter(event => event.type === 'sheet-create').length, 0);
  assert.ok(events.some(event => event.type === 'list' && event.args.pageToken === 'page-two'));
});

test('repeated photo uploads reuse a private Drive file and concurrent attempts upload once', async () => {
  let uploads = 0;
  globalThis.fetch = async (_url, options) => {
    uploads += 1;
    assert.equal(options?.method, 'POST');
    const metadata = JSON.parse(await ((options!.body as FormData).get('metadata') as Blob).text());
    images.push({ id: 'image-new', name: metadata.name });
    return new Response(JSON.stringify({ id: 'image-new' }), { status: 200 });
  };
  assert.deepEqual(await Promise.all([api.uploadImageToDrive('YQ==', 'new'), api.uploadImageToDrive('YQ==', 'new')]), ['image-new', 'image-new']);
  assert.equal(await api.uploadImageToDrive('YQ==', 'new'), 'image-new');
  assert.equal(uploads, 1);
});

test('failed photo upload surfaces HTTP errors and remains retryable', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Storage quota exceeded' } }), { status: 403 });
  await assert.rejects(api.uploadImageToDrive('YQ==', 'new'), /Storage quota exceeded/);
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'image-new' }), { status: 200 });
  assert.equal(await api.uploadImageToDrive('YQ==', 'new'), 'image-new');
});

test('photo cleanup follows Drive pagination and failure remains visible for retry', async () => {
  listOverride = args => args.q.startsWith("(name='first.jpg'") ? {
    result: args.pageToken ? { files: [{ id: 'image-copy', name: 'first.jpg' }] } : { files: [{ id: 'image-first', name: 'first.jpg' }], nextPageToken: 'more-images' },
  } : null;
  await api.deleteCardFromSheet('first');
  assert.deepEqual(events.filter(event => event.type === 'image-delete').map(event => event.args.fileId), ['image-first', 'image-copy']);
});

test('expired authentication has a user-facing error instead of an opaque GAPI object', async () => {
  listOverride = () => { throw { status: 401, result: { error: { message: 'Invalid Credentials' } } }; };
  await assert.rejects(api.prepareCloudStorage(), /登入已到期/);
});

test('signing out during initialization prevents queued writes to another account', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  globals.client.drive.files.list = async () => { await gate; return { result: { files: [{ id: 'old-account-sheet' }] } }; };
  const pending = api.addCardsToSheet([makeCard('new')]);
  await new Promise(resolve => setImmediate(resolve));
  api.signOut();
  token = { access_token: 'different-test-account' };
  release();
  await assert.rejects(pending, /帳號已變更/);
  assert.equal(events.filter(event => event.type === 'append' || event.type === 'update').length, 0);
});

test('GAPI initialization failure is reported and a subsequent attempt succeeds', async () => {
  let attempts = 0;
  globals.client.init = async () => { attempts += 1; if (attempts === 1) throw { result: { error: { message: 'Temporarily unavailable' } } }; };
  await assert.rejects(api.loadGapi(), /Temporarily unavailable/);
  let callbackRan = false;
  await api.loadGapi(() => { callbackRan = true; });
  assert.equal(attempts, 2);
  assert.equal(callbackRan, true);
});

test('GIS initialization waits for a delayed script and preserves explicit popup cancellation', async () => {
  let captured: any;
  let callbackResponse: any;
  (globalThis as any).document = { scripts: [{ src: 'https://accounts.google.com/gsi/client', dataset: {}, addEventListener() {}, removeEventListener() {} }] };
  const ready = api.initGis(response => { callbackResponse = response; });
  setTimeout(() => {
    (globalThis as any).google = { accounts: { oauth2: { initTokenClient: (options: any) => { captured = options; return {}; } } } };
  }, 5);
  await ready;
  captured.error_callback({ type: 'popup_closed' });
  assert.equal(callbackResponse.error, 'popup_closed');
  assert.match(callbackResponse.error_description, /關閉/);
});


test('replacing a photo creates a distinct revision and sheet failure leaves the old photo intact', async () => {
  const uploaded: Array<{ id: string; name: string }> = [];
  globalThis.fetch = async (_url, options) => {
    const metadata = JSON.parse(await ((options!.body as FormData).get('metadata') as Blob).text());
    const file = { id: `revision-${uploaded.length + 1}`, name: metadata.name };
    uploaded.push(file); images.push(file);
    return new Response(JSON.stringify({ id: file.id }), { status: 200 });
  };
  const first = await api.uploadImageToDrive('YQ==', 'first');
  const replacement = await api.uploadImageToDrive('Yg==', 'first');
  assert.notEqual(first, replacement);
  assert.equal(uploaded.length, 2);
  assert.match(uploaded[0].name, /^first-[a-f0-9]{32}\.jpg$/);
  assert.notEqual(uploaded[0].name, uploaded[1].name);
  assert.equal(await api.uploadImageToDrive('data:image/jpeg;base64,Yg==', 'first'), replacement);
  assert.equal(uploaded.length, 2, 'Same image data must reuse its version regardless of data URL wrapper');
  rows[1][9] = first;
  globals.client.sheets.spreadsheets.values.update = async () => { throw { result: { error: { message: 'Synthetic write failure' } } }; };
  await assert.rejects(api.updateCardInSheet(makeCard('first', { timestamp: 200, imageDriveId: replacement })), /Synthetic write failure/);
  assert.equal(rows[1][9], first);
  assert.ok(images.some(image => image.id === first));
  assert.ok(images.some(image => image.id === 'image-first'), 'Legacy photos remain readable by their existing Drive ID');
  assert.equal(events.filter(event => event.type === 'image-delete').length, 0);
});

test('deletion removes legacy and all photo revisions but never a different card with a matching prefix', async () => {
  images.push(
    { id: 'revision-one', name: `first-${'a'.repeat(32)}.jpg` },
    { id: 'revision-two', name: `first-${'b'.repeat(32)}.jpg` },
    { id: 'different-card', name: `first-other-${'c'.repeat(32)}.jpg` },
    { id: 'unrelated-file', name: 'first-contract.jpg' },
  );
  await api.deleteCardFromSheet('first');
  assert.deepEqual(events.filter(event => event.type === 'image-delete').map(event => event.args.fileId).sort(), ['image-first', 'revision-one', 'revision-two']);
  assert.deepEqual(images.map(image => image.id).sort(), ['different-card', 'image-second', 'unrelated-file']);
});

test('concurrent uploads of two different photos on one card cannot reuse the wrong revision', async () => {
  let uploads = 0;
  globalThis.fetch = async () => new Response(JSON.stringify({ id: `concurrent-${++uploads}` }), { status: 200 });
  const ids = await Promise.all([api.uploadImageToDrive('YQ==', 'first'), api.uploadImageToDrive('Yg==', 'first')]);
  assert.equal(new Set(ids).size, 2);
  assert.equal(uploads, 2);
});
