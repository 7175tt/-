export interface ImageRectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_PHOTO_EDGE = 3200;
export const MAX_JPEG_BYTES = 3 * 1024 * 1024;

interface PhotoSizeRange { min?: number; max?: number; step?: number }
interface PhotoCapabilities { imageWidth?: PhotoSizeRange; imageHeight?: PhotoSizeRange }

export interface StillCamera {
  getPhotoCapabilities?: () => Promise<PhotoCapabilities>;
  takePhoto: (settings?: { imageWidth?: number; imageHeight?: number }) => Promise<Blob>;
}

export function createStillCamera(track: MediaStreamTrack): StillCamera | null {
  const Constructor = (globalThis as unknown as { ImageCapture?: new (track: MediaStreamTrack) => StillCamera }).ImageCapture;
  if (!Constructor) return null;
  try {
    const camera = new Constructor(track);
    return typeof camera.takePhoto === 'function' ? camera : null;
  } catch { return null; }
}

export function isStillCameraUnsupported(error: unknown): boolean {
  return error instanceof Error && error.name === 'NotSupportedError';
}

export function getStillPhotoSettings(capabilities: PhotoCapabilities): { imageWidth?: number; imageHeight?: number } | undefined {
  const width = capabilities.imageWidth?.max;
  const height = capabilities.imageHeight?.max;
  if (!Number.isFinite(width) || width! <= 0 || !Number.isFinite(height) || height! <= 0) return undefined;
  const scale = Math.min(1, 4800 / Math.max(width!, height!));
  // Very large phone sensors can expose 48/108MP stills. Request enough real
  // pixels for a 3200px saved image without decoding their largest mode.
  const fit = (range: PhotoSizeRange, target: number) => {
    const minimum = Number.isFinite(range.min) && range.min! > 0 ? range.min! : 1;
    const step = Number.isFinite(range.step) && range.step! > 0 ? range.step! : 1;
    return Math.min(range.max!, minimum + Math.floor((Math.max(minimum, target) - minimum) / step) * step);
  };
  return { imageWidth: fit(capabilities.imageWidth!, width! * scale), imageHeight: fit(capabilities.imageHeight!, height! * scale) };
}

/** Ask the sensor for a photograph, not a frame from its lower-resolution preview. */
export async function takeHighResolutionPhoto(camera: StillCamera, isCurrent: () => boolean = () => true): Promise<Blob> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  try {
    return await Promise.race([
      requestHighResolutionPhoto(camera, () => expired || !isCurrent()),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { expired = true; reject(new Error('相機拍照逾時，請重試或使用手機相機。')); }, 12000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function requestHighResolutionPhoto(camera: StillCamera, isExpired: () => boolean): Promise<Blob> {
  let settings: { imageWidth?: number; imageHeight?: number } | undefined;
  try {
    const capabilities = await camera.getPhotoCapabilities?.();
    if (capabilities) settings = getStillPhotoSettings(capabilities);
  } catch { /* Some browsers support taking photos but not querying their sizes. */ }
  if (isExpired()) throw new Error('相機拍照已取消。');
  try {
    return await camera.takePhoto(settings);
  } catch (error) {
    // The individual maxima are not always a supported width/height pair. Ask
    // the camera for its default still size before considering video fallback.
    if (settings && error instanceof Error && ['NotSupportedError', 'OverconstrainedError', 'TypeError'].includes(error.name)) {
      if (isExpired()) throw error;
      return camera.takePhoto();
    }
    throw error;
  }
}

/** The real image bounds inside an object-contain video, excluding its bars. */
export function getContainedImageRect(sourceWidth: number, sourceHeight: number, viewport: ImageRectangle): ImageRectangle {
  if (![sourceWidth, sourceHeight, viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('相機畫面尚未準備好，請稍後再拍攝。');
  }
  const scale = Math.min(viewport.width / sourceWidth, viewport.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { left: viewport.left + (viewport.width - width) / 2, top: viewport.top + (viewport.height - height) / 2, width, height };
}

/** Map a guide in page coordinates to the exact video frame shown by object-cover. */
export function getObjectCoverCrop(sourceWidth: number, sourceHeight: number, viewport: ImageRectangle, guide: ImageRectangle): ImageCrop {
  const dimensions = [sourceWidth, sourceHeight, viewport.width, viewport.height, guide.width, guide.height];
  if (dimensions.some(value => !Number.isFinite(value) || value <= 0)) throw new Error('相機畫面尚未準備好，請稍後再拍攝。');
  if (![viewport.left, viewport.top, guide.left, guide.top].every(Number.isFinite)) throw new Error('無法讀取取景框位置。');
  const scale = Math.max(viewport.width / sourceWidth, viewport.height / sourceHeight);
  const offsetX = (viewport.width - sourceWidth * scale) / 2;
  const offsetY = (viewport.height - sourceHeight * scale) / 2;
  const guideLeft = Math.max(0, guide.left - viewport.left);
  const guideTop = Math.max(0, guide.top - viewport.top);
  const guideRight = Math.min(viewport.width, guide.left - viewport.left + guide.width);
  const guideBottom = Math.min(viewport.height, guide.top - viewport.top + guide.height);
  const x = Math.max(0, (guideLeft - offsetX) / scale);
  const y = Math.max(0, (guideTop - offsetY) / scale);
  const right = Math.min(sourceWidth, (guideRight - offsetX) / scale);
  const bottom = Math.min(sourceHeight, (guideBottom - offsetY) / scale);
  if (right <= x || bottom <= y) throw new Error('請讓名片完整位於取景框內，再重新拍攝。');
  return { x, y, width: right - x, height: bottom - y };
}

export function getImageSize(width: number, height: number, maxEdge = MAX_PHOTO_EDGE) {
  if (![width, height, maxEdge].every(value => Number.isFinite(value) && value > 0)) throw new Error('無法讀取照片尺寸。');
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function validateImageFile(file: Pick<File, 'type' | 'size' | 'name'>) {
  if (!file.size) throw new Error('照片是空白檔案，請重新選擇。');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('每張照片最多 25 MB，請先縮小照片。');
  const supportedMime = /^image\/(jpeg|png|webp|gif|avif|heic|heif|bmp)$/i.test(file.type);
  const supportedExtension = !file.type && /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)$/i.test(file.name);
  if (!supportedMime && !supportedExtension) throw new Error('請選擇 JPG、PNG、WebP 或手機拍攝的照片。');
}

/** Keep small text readable while bounding upload and local storage size. */
export function imageToJpegBase64(source: CanvasImageSource, crop: ImageCrop, maxEdge = MAX_PHOTO_EDGE): string {
  const canvas = document.createElement('canvas');
  let size = getImageSize(crop.width, crop.height, maxEdge);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('此瀏覽器無法處理照片，請換用新版瀏覽器。');
  for (let attempt = 0; attempt < 5; attempt++) {
    canvas.width = size.width;
    canvas.height = size.height;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size.width, size.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height);
    // Try modest JPEG compression before discarding real image pixels.
    for (const quality of [0.92, 0.88, 0.84]) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const base64 = dataUrl.split(',')[1];
      if (!base64 || !dataUrl.startsWith('data:image/jpeg;')) throw new Error('照片處理失敗，請重新選擇照片。');
      if (base64.length * 0.75 <= MAX_JPEG_BYTES) return base64;
    }
    size = getImageSize(size.width, size.height, Math.max(size.width, size.height) * 0.85);
  }
  throw new Error('照片內容過大，請只拍攝名片範圍後再試一次。');
}

export async function imageFileToJpegBase64(file: File): Promise<string> {
  validateImageFile(file);
  return imageBlobToJpegBase64(file);
}

/** Full-frame stills avoid clipping when photo and preview fields of view differ. */
export async function imageBlobToJpegBase64(blob: Blob): Promise<string> {
  if (!blob.size) throw new Error('相機回傳空白照片，請重新拍攝。');
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('無法開啟這張照片。若是 HEIC 格式，請改用 JPG 或手機相機重新拍攝。'));
      image.src = objectUrl;
    });
    // Browsers apply the photo's EXIF orientation before reporting these dimensions.
    return imageToJpegBase64(image, { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
