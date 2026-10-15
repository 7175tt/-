import type { BusinessCard } from '../types';
import { getGeminiKeySettings } from './geminiKeySettings';

export type ScannedCard = Pick<BusinessCard, 'name' | 'company' | 'title' | 'phone' | 'email' | 'address' | 'notes' | 'rawText'>;

export class ScanRequestError extends Error {
  constructor(message: string, public code: string, public status = 0) {
    super(message);
    this.name = 'ScanRequestError';
  }
}

async function request(path: string, body?: object, signal?: AbortSignal, suppliedKey?: string): Promise<Record<string, unknown>> {
  // Capture the selected credential once for this request. It is never placed
  // in a URL, a card record, a response, or a shared backend configuration.
  const apiKey = body ? (suppliedKey ?? getGeminiKeySettings().apiKey).trim() : '';
  if (suppliedKey !== undefined && !/^[A-Za-z0-9_-]{20,256}$/.test(apiKey)) {
    throw new ScanRequestError('API key 格式不正確，請重新複製完整金鑰。', 'INVALID_API_KEY', 400);
  }
  if (apiKey && typeof location !== 'undefined' && location.protocol !== 'https:'
    && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    throw new ScanRequestError('請透過 HTTPS 開啟網站，再使用個人 API key。', 'HTTPS_REQUIRED');
  }
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, body ? 50_000 : 10_000);
  try {
    const response = await fetch(`/api/gemini/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json', ...(apiKey ? { 'x-gemini-api-key': apiKey } : {}) } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'error',
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ScanRequestError(
        typeof data?.error === 'string' && (!apiKey || !data.error.includes(apiKey)) ? data.error : '掃描服務暫時無法使用，請檢查 AI 辨識設定後重試。',
        typeof data?.code === 'string' ? data.code : 'SERVICE_UNAVAILABLE',
        response.status,
      );
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ScanRequestError('掃描回應不完整，請重試。', 'INVALID_RESPONSE');
    }
    return data;
  } catch (error) {
    if (timedOut) throw new ScanRequestError('掃描時間較長，請重試或先手動輸入。', 'SCAN_TIMEOUT');
    if (signal?.aborted) throw new DOMException('掃描已取消。', 'AbortError');
    if (error instanceof ScanRequestError) throw error;
    throw new ScanRequestError('無法連線至掃描服務，請確認網路後重試。', 'NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function readCard(data: Record<string, unknown>): ScannedCard {
  const card = data.structuredData as ScannedCard | undefined;
  const fields: (keyof ScannedCard)[] = ['name', 'company', 'title', 'phone', 'email', 'address', 'notes', 'rawText'];
  if (!card || fields.some(field => typeof card[field] !== 'string')) {
    throw new ScanRequestError('掃描回應不完整，請重試。', 'INVALID_RESPONSE');
  }
  return Object.fromEntries(fields.map(field => [field, card[field]])) as ScannedCard;
}

/** Extract the text and all contact fields in one request. */
export async function scanBusinessCard(base64Image: string, signal?: AbortSignal): Promise<ScannedCard> {
  return readCard(await request('scan', { base64Image }, signal));
}

/** This checks configuration presence; a real scan can still fail at the provider. */
export async function getScanReadiness(signal?: AbortSignal): Promise<{ configured: boolean }> {
  const data = await request('status', undefined, signal);
  if (typeof data.configured !== 'boolean') throw new ScanRequestError('無法確認掃描服務狀態。', 'INVALID_RESPONSE');
  return { configured: data.configured };
}

/** A small real model request verifies this personal key; it can consume quota. */
export async function checkGeminiApiKey(apiKey: string, signal?: AbortSignal): Promise<{ valid: true; model: string }> {
  const data = await request('check-key', {}, signal, apiKey);
  if (data.valid !== true || typeof data.model !== 'string' || !data.model) {
    throw new ScanRequestError('金鑰測試回應不完整，請重試。', 'INVALID_RESPONSE');
  }
  return { valid: true, model: data.model };
}

export async function extractTextFromImage(base64Image: string, signal?: AbortSignal): Promise<string> {
  const data = await request('extract', { base64Image }, signal);
  if (typeof data.text !== 'string') throw new ScanRequestError('掃描回應不完整，請重試。', 'INVALID_RESPONSE');
  return data.text;
}

/** Compatibility for callers of the previous text-only endpoint. */
export async function structureText(rawText: string): Promise<ScannedCard | null> {
  try {
    return readCard(await request('structure', { rawText }));
  } catch {
    return null;
  }
}
