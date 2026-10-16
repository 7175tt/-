import express from 'express';

const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const UNAVAILABLE = '無法讀取這張照片的既有分享連結，請在 Google Drive 確認原始檔案與存取權。';

class PhotoError extends Error {
  constructor(readonly status: number, message = UNAVAILABLE) { super(message); }
}

function imageType(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'image/gif';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Read only an existing anonymously readable Drive photo; never change its ACL. */
export function createDrivePhotoRouter(options: { fetch?: typeof fetch; timeoutMs?: number; maxBytes?: number } = {}) {
  const router = express.Router();
  const request = options.fetch ?? fetch;
  const maxBytes = options.maxBytes ?? MAX_PHOTO_BYTES;
  router.get('/public-photo/:fileId', async (req, res) => {
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(req.params.fileId)) {
      res.status(400).json({ error: '照片 ID 格式不正確。' });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
    const disconnect = () => controller.abort();
    res.on('close', disconnect);
    try {
      // Do not forward browser cookies, OAuth tokens, API keys, or arbitrary URLs.
      let url = new URL('https://drive.usercontent.google.com/uc');
      url.searchParams.set('id', req.params.fileId);
      url.searchParams.set('export', 'download');
      let response: Response | undefined;
      for (let redirects = 0; redirects <= 3; redirects++) {
        response = await request(url.href, { method: 'GET', credentials: 'omit', redirect: 'manual', signal: controller.signal });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects === 3) throw new PhotoError(404);
        const next = new URL(location, url);
        const allowedHost = next.hostname === 'drive.usercontent.google.com' || next.hostname.endsWith('.googleusercontent.com');
        if (next.protocol !== 'https:' || next.username || next.password || next.port || !allowedHost) throw new PhotoError(404);
        url = next;
      }
      if (!response?.ok) {
        await response?.body?.cancel();
        throw new PhotoError(response?.status === 429 ? 429 : 404);
      }
      const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      if (contentType && !contentType.startsWith('image/') && contentType !== 'application/octet-stream') {
        await response.body?.cancel();
        throw new PhotoError(404); // Login/consent/download warning pages are not photos.
      }
      if (Number(response.headers.get('content-length')) > maxBytes) {
        await response.body?.cancel();
        throw new PhotoError(413, '原始照片超過可下載大小，請在編輯名片時重新選取照片。');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new PhotoError(404);
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > maxBytes) throw new PhotoError(413, '原始照片超過可下載大小，請在編輯名片時重新選取照片。');
          chunks.push(Buffer.from(chunk.value));
        }
      } finally { await reader.cancel(); }
      const bytes = Buffer.concat(chunks, size);
      const type = imageType(bytes);
      if (!type) throw new PhotoError(404);
      res.type(type).send(bytes);
    } catch (error) {
      if (!res.destroyed && !res.headersSent) {
        const status = error instanceof PhotoError ? error.status : controller.signal.aborted ? 504 : 502;
        res.status(status).json({ error: error instanceof PhotoError ? error.message : '舊照片下載暫時未完成，請稍後重試。' });
      }
    } finally {
      clearTimeout(timer);
      res.off('close', disconnect);
    }
  });
  return router;
}
