import { BusinessCard } from '../types';
import { GOOGLE_CLIENT_ID, SPREADSHEET_NAME, CARD_SHEET_NAME, IMAGE_FOLDER_NAME } from '../config';

declare const gapi: any;
declare const google: any;

const DISCOVERY_DOCS = ['https://www.googleapis.com/discovery/v1/apis/sheets/v4/rest', 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'];
// Sheets accepts drive.file for this app's own files; access to every spreadsheet is unnecessary.
// https://developers.google.com/workspace/sheets/api/scopes
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email';
// Keep the original A:J schema. OCR text is an additive, backwards-compatible column.
const cardHeaders = ['id', 'name', 'company', 'title', 'phone', 'email', 'address', 'notes', 'timestamp', 'imageDriveId', 'rawText'] as const;
const sheetRange = `'${CARD_SHEET_NAME.replace(/'/g, "''")}'`;
type SheetCard = Omit<BusinessCard, 'imageBase64'>;
type Storage = { spreadsheetId: string; imageFolderId: string; session: number };

let tokenClient: any = null;
let gapiInitialization: Promise<void> | null = null;
let storageInitialization: Promise<Storage> | null = null;
let session = 0;
let mutationQueue: Promise<unknown> = Promise.resolve();
const imageUploads = new Map<string, Promise<string>>();

function apiError(error: any, action: string): Error {
  const status = error?.status ?? error?.result?.error?.code ?? error?.error?.code;
  if (status === 401) return new Error('Google 登入已到期，請重新登入後再同步。');
  const detail = error?.result?.error?.message ?? error?.error?.message ?? error?.message;
  return new Error(`${action}失敗${detail ? `：${detail}` : '，請檢查網路連線後重試。'}`);
}

async function withApiError<T>(action: string, operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { throw apiError(error, action); }
}

function accessToken(): string {
  const token = typeof gapi !== 'undefined' && gapi.client?.getToken()?.access_token;
  if (!token) throw new Error('請先登入 Google 帳號。');
  return token;
}

function assertSession(expected: number) {
  if (session !== expected) throw new Error('Google 帳號已變更，請重新同步。');
  accessToken();
}

/** Wait for deferred scripts, report load failures, and allow a later call to retry. */
async function waitForScript(ready: () => boolean, src: string): Promise<void> {
  if (ready()) return;
  if (typeof document === 'undefined') throw new Error('Google 服務只能在瀏覽器中使用。');
  let script = Array.from(document.scripts).find(item => item.src === src);
  if (script?.dataset.googleLoadFailed === 'true') { script.remove(); script = undefined; }
  let added = false;
  if (!script) {
    script = document.createElement('script');
    script.src = src;
    script.async = true;
    added = true;
  }
  const target = script;
  await new Promise<void>((resolve, reject) => {
    const cleanUp = () => { clearInterval(poll); clearTimeout(timeout); target.removeEventListener('error', failed); };
    const failed = () => {
      cleanUp();
      target.dataset.googleLoadFailed = 'true';
      reject(new Error('Google 服務載入失敗，請檢查網路後重試。'));
    };
    const poll = setInterval(() => { if (ready()) { cleanUp(); resolve(); } }, 50);
    const timeout = setTimeout(failed, 12000);
    target.addEventListener('error', failed, { once: true });
    if (added) document.head.appendChild(target);
  });
}

/** The returned promise rejects on failure; callers can retry without reloading the app. */
export function loadGapi(callback?: () => void | Promise<void>, onError?: (error: Error) => void): Promise<void> {
  if (!gapiInitialization) {
    gapiInitialization = (async () => {
      await waitForScript(() => typeof gapi !== 'undefined' && !!gapi.load, 'https://apis.google.com/js/api.js');
      await new Promise<void>((resolve, reject) => {
        gapi.load('client', {
          callback: resolve,
          onerror: () => reject(new Error('Google API 載入失敗，請重試。')),
          timeout: 12000,
          ontimeout: () => reject(new Error('Google API 載入逾時，請重試。')),
        });
      });
      await gapi.client.init({ discoveryDocs: DISCOVERY_DOCS });
    })().catch(error => { gapiInitialization = null; throw apiError(error, '載入 Google 服務'); });
  }
  const result = gapiInitialization.then(() => callback?.());
  // An error callback also supports consumers that do not await the returned promise.
  if (onError) return result.catch(onError);
  return result;
}

export async function initGis(callback: (tokenResponse: any) => void): Promise<void> {
  await waitForScript(() => typeof google !== 'undefined' && !!google.accounts?.oauth2, 'https://accounts.google.com/gsi/client');
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPES,
    include_granted_scopes: false,
    callback,
    error_callback: (error: any) => callback({
      error: error.type || 'gis_error',
      error_description: error.type === 'popup_closed' ? '登入視窗已關閉。' : error.message || '無法開啟 Google 登入，請重試。',
    }),
  });
}

export function signInWithPopup() {
  if (!tokenClient) throw new Error('Google 登入尚未準備就緒，請重試。');
  tokenClient.requestAccessToken({});
}

export function signInSilently() {
  if (!tokenClient) throw new Error('Google 登入尚未準備就緒，請重試。');
  tokenClient.requestAccessToken({ prompt: 'none' });
}

export function signOut() {
  if (typeof gapi !== 'undefined') gapi.client?.setToken(null);
  session += 1;
  storageInitialization = null;
  mutationQueue = Promise.resolve();
  imageUploads.clear();
}

function escapeQuery(value: string) { return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

async function listFiles(q: string, expected: number): Promise<Array<{ id: string; name?: string }>> {
  const files: Array<{ id: string; name?: string }> = [];
  let pageToken: string | undefined;
  do {
    assertSession(expected);
    const response = await gapi.client.drive.files.list({
      q, fields: 'nextPageToken,files(id,name)', pageSize: 100, orderBy: 'createdTime', ...(pageToken ? { pageToken } : {}),
    });
    files.push(...(response.result.files || []));
    pageToken = response.result.nextPageToken;
  } while (pageToken);
  return files;
}

async function findOrCreateSpreadsheet(expected: number): Promise<string> {
  const files = await listFiles(`mimeType='application/vnd.google-apps.spreadsheet' and name='${escapeQuery(SPREADSHEET_NAME)}' and trashed=false`, expected);
  assertSession(expected);
  if (files[0]?.id) {
    // Do not replace an existing custom column while upgrading old A:J spreadsheets.
    const header = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId: files[0].id, range: `${sheetRange}!K1` });
    const existing = header.result.values?.[0]?.[0];
    if (existing && existing !== 'rawText') throw new Error('試算表 K 欄已被使用，請將 K 欄保留給 rawText 後再同步。');
    if (!existing) {
      assertSession(expected);
      await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: files[0].id, range: `${sheetRange}!K1`, valueInputOption: 'RAW', resource: { values: [['rawText']] },
      });
    }
    return files[0].id;
  }
  const response = await gapi.client.sheets.spreadsheets.create({
    properties: { title: SPREADSHEET_NAME }, sheets: [{ properties: { title: CARD_SHEET_NAME } }],
  });
  const id = response.result.spreadsheetId;
  if (!id) throw new Error('Google 未回傳試算表 ID。');
  assertSession(expected);
  await gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId: id, range: `${sheetRange}!A1`, valueInputOption: 'RAW', resource: { values: [cardHeaders] },
  });
  return id;
}

async function findOrCreateImageFolder(expected: number): Promise<string> {
  const files = await listFiles(`mimeType='application/vnd.google-apps.folder' and name='${escapeQuery(IMAGE_FOLDER_NAME)}' and trashed=false`, expected);
  if (files[0]?.id) return files[0].id;
  assertSession(expected);
  const response = await gapi.client.drive.files.create({ resource: { name: IMAGE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }, fields: 'id' });
  if (!response.result.id) throw new Error('Google 未回傳照片資料夾 ID。');
  return response.result.id;
}

async function initializeCloudStorage(): Promise<Storage> {
  const expected = session;
  assertSession(expected);
  if (!storageInitialization) {
    const pending = (async () => {
      const spreadsheetId = await findOrCreateSpreadsheet(expected);
      const imageFolderId = await findOrCreateImageFolder(expected);
      assertSession(expected);
      return { spreadsheetId, imageFolderId, session: expected };
    })();
    storageInitialization = pending;
    pending.catch(() => { if (storageInitialization === pending) storageInitialization = null; });
  }
  const storage = await storageInitialization;
  assertSession(expected);
  return storage;
}

export async function prepareCloudStorage(): Promise<{ spreadsheetId: string }> {
  return withApiError('準備雲端空間', async () => ({ spreadsheetId: (await initializeCloudStorage()).spreadsheetId }));
}

async function checkedResponse(response: Response, action: string): Promise<any> {
  if (response.ok) return response.json();
  const body = await response.json().catch(() => ({}));
  throw apiError({ status: response.status, message: body?.error?.message || response.statusText || `HTTP ${response.status}` }, action);
}

export async function getImageAsBase64(fileId: string): Promise<string> {
  return withApiError('下載名片照片', async () => {
    if (!fileId) throw new Error('缺少照片 ID。');
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken()}` },
    });
    if (!response.ok) await checkedResponse(response, '下載名片照片');
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result.split(',')[1] : '';
        if (!result) reject(new Error('照片內容為空。')); else resolve(result);
      };
      reader.onerror = () => reject(new Error('無法讀取名片照片。'));
      reader.readAsDataURL(blob);
    });
  });
}

function rowToCard(row: unknown[]): BusinessCard {
  const card = Object.fromEntries(cardHeaders.map((header, index) => [header, row[index] ?? ''])) as unknown as BusinessCard;
  cardHeaders.forEach(header => { if (header !== 'timestamp') (card as any)[header] = String(card[header] ?? ''); });
  const timestamp = Number(card.timestamp);
  // A missing timestamp must not appear newer than valid local edits on every read.
  card.timestamp = Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : 0;
  return card;
}

async function readRows(storage: Storage): Promise<unknown[][]> {
  assertSession(storage.session);
  const response = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId: storage.spreadsheetId, range: `${sheetRange}!A2:K` });
  assertSession(storage.session);
  return response.result.values || [];
}

export async function getCloudCardsLight(): Promise<{ cards: BusinessCard[]; spreadsheetId: string }> {
  return withApiError('讀取雲端名片', async () => {
    const storage = await initializeCloudStorage();
    const byId = new Map<string, BusinessCard>();
    for (const row of await readRows(storage)) {
      if (!row[0]) continue;
      const card = rowToCard(row);
      if (!byId.has(card.id) || card.timestamp >= byId.get(card.id)!.timestamp) byId.set(card.id, card);
    }
    return { cards: Array.from(byId.values()), spreadsheetId: storage.spreadsheetId };
  });
}

export async function getCloudCards(): Promise<{ cards: BusinessCard[]; spreadsheetId: string }> {
  const result = await getCloudCardsLight();
  // Bound parallel downloads so large collections do not flood Drive or the phone.
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, result.cards.length) }, async () => {
    while (next < result.cards.length) {
      const card = result.cards[next++];
      if (card.imageDriveId) {
        try { card.imageBase64 = await getImageAsBase64(card.imageDriveId); }
        catch { /* Preserve the cloud ID so the user can retry the image later. */ }
      }
    }
  }));
  return result;
}

function base64ToBlob(base64: string): Blob {
  const match = base64.match(/^data:(image\/[\w.+-]+);base64,(.*)$/s);
  const bytes = Uint8Array.from(atob(match ? match[2] : base64), character => character.charCodeAt(0));
  return new Blob([bytes], { type: match ? match[1] : 'image/jpeg' });
}

/** Identical captures reuse their file; replacing a photo creates a new revision. */
export async function uploadImageToDrive(base64Image: string, cardId: string): Promise<string> {
  return withApiError('上傳名片照片', async () => {
    if (!cardId) throw new Error('缺少名片 ID。');
    const expected = session;
    assertSession(expected);
    const blob = base64ToBlob(base64Image);
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    // A stable 128-bit content prefix makes retries idempotent without replacing
    // the old photo before its new spreadsheet reference has been committed.
    const hash = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
    assertSession(expected);
    const name = `${cardId}-${hash}.jpg`;
    const current = imageUploads.get(name);
    if (current) return current;
    const pending = (async () => {
      const storage = await initializeCloudStorage();
      assertSession(expected);
      const files = await listFiles(`name='${escapeQuery(name)}' and '${escapeQuery(storage.imageFolderId)}' in parents and trashed=false`, storage.session);
      if (files[0]?.id) return files[0].id;
      assertSession(storage.session);
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify({ name, parents: [storage.imageFolderId] })], { type: 'application/json' }));
      form.append('file', blob);
      const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken()}` }, body: form,
      });
      const result = await checkedResponse(response, '上傳名片照片');
      assertSession(storage.session);
      if (!result.id) throw new Error('Google 未回傳照片 ID。');
      // Photos stay private; getImageAsBase64 downloads with the owner's OAuth token.
      return result.id as string;
    })();
    imageUploads.set(name, pending);
    try { return await pending; }
    finally { if (imageUploads.get(name) === pending) imageUploads.delete(name); }
  });
}

async function deleteImages(cardId: string, storage: Storage): Promise<void> {
  const prefix = `${cardId}-`;
  const legacyName = `${cardId}.jpg`;
  const files = await listFiles(`(name='${escapeQuery(legacyName)}' or name contains '${escapeQuery(prefix)}') and '${escapeQuery(storage.imageFolderId)}' in parents and trashed=false`, storage.session);
  // Drive's prefix search can also match other card IDs. Only delete this card's
  // exact legacy filename or the content-hashed revisions written by this app.
  for (const file of files.filter(file => file.name === legacyName
    || (file.name?.startsWith(prefix) && /^[a-f0-9]{32}\.jpg$/.test(file.name.slice(prefix.length))))) {
    assertSession(storage.session);
    try { await gapi.client.drive.files.delete({ fileId: file.id }); }
    catch (error: any) { if (error?.status !== 404 && error?.result?.error?.code !== 404) throw error; }
  }
}

export async function deleteCardImage(cardId: string): Promise<void> {
  return withApiError('刪除名片照片', async () => deleteImages(cardId, await initializeCloudStorage()));
}

function serializeMutation<T>(action: string, operation: (storage: Storage) => Promise<T>): Promise<T> {
  const expected = session;
  const result = mutationQueue.catch(() => {}).then(() => withApiError(action, async () => {
    assertSession(expected);
    const storage = await initializeCloudStorage();
    assertSession(expected);
    return operation(storage);
  }));
  mutationQueue = result;
  return result;
}

async function upsertCards(cards: SheetCard[], storage: Storage): Promise<void> {
  if (!cards.length) return;
  const rows = await readRows(storage);
  const unique = new Map<string, SheetCard>();
  for (const card of cards) {
    if (!card.id) throw new Error('名片缺少 ID，無法同步。');
    if (!unique.has(card.id) || card.timestamp >= unique.get(card.id)!.timestamp) unique.set(card.id, card);
  }
  const additions: unknown[][] = [];
  for (const card of unique.values()) {
    const matching = rows.flatMap((row, index) => String(row[0]) === card.id ? [index] : []);
    const values = cardHeaders.map(header => card[header] ?? '');
    if (!matching.length) { additions.push(values); continue; }
    // A retried older request must not overwrite a later edit already on another device.
    if (matching.some(index => rowToCard(rows[index]).timestamp > card.timestamp)) continue;
    for (const index of matching) {
      assertSession(storage.session);
      await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: storage.spreadsheetId, range: `${sheetRange}!A${index + 2}:K${index + 2}`,
        valueInputOption: 'RAW', resource: { values: [values] },
      });
    }
  }
  if (additions.length) {
    assertSession(storage.session);
    await gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId: storage.spreadsheetId, range: `${sheetRange}!A1:K`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', resource: { values: additions },
    });
  }
}

/** Upserts by stable card ID, including retries after an uncertain append response. */
export async function addCardsToSheet(cards: SheetCard[]): Promise<void> {
  return serializeMutation('儲存雲端名片', storage => upsertCards(cards, storage));
}

export async function updateCardInSheet(card: SheetCard): Promise<void> {
  return serializeMutation('更新雲端名片', storage => upsertCards([card], storage));
}

export async function deleteCardFromSheet(cardId: string): Promise<void> {
  return serializeMutation('刪除雲端名片', async storage => {
    const rows = await readRows(storage);
    const indices = rows.flatMap((row, index) => String(row[0]) === cardId ? [index + 1] : []);
    if (indices.length) {
      assertSession(storage.session);
      const response = await gapi.client.sheets.spreadsheets.get({ spreadsheetId: storage.spreadsheetId, fields: 'sheets.properties' });
      const sheet = response.result.sheets?.find((item: any) => item.properties?.title === CARD_SHEET_NAME);
      if (sheet?.properties?.sheetId == null) throw new Error(`找不到工作表「${CARD_SHEET_NAME}」。`);
      assertSession(storage.session);
      await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: storage.spreadsheetId,
        resource: { requests: indices.reverse().map(index => ({ deleteDimension: { range: {
          sheetId: sheet.properties.sheetId, dimension: 'ROWS', startIndex: index, endIndex: index + 1,
        } } })) },
      });
    }
    // Only remove photos after the sheet confirms deletion. Retrying also cleans orphan photos.
    await deleteImages(cardId, storage);
  });
}
