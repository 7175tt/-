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
const MAX_JPEG_BYTES = 2 * 1024 * 1024;

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

export function getImageSize(width: number, height: number, maxEdge = 2000) {
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
export function imageToJpegBase64(source: CanvasImageSource, crop: ImageCrop): string {
  const canvas = document.createElement('canvas');
  let size = getImageSize(crop.width, crop.height);
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
    const dataUrl = canvas.toDataURL('image/jpeg', attempt === 0 ? 0.88 : 0.8);
    const base64 = dataUrl.split(',')[1];
    if (!base64 || !dataUrl.startsWith('data:image/jpeg;')) throw new Error('照片處理失敗，請重新選擇照片。');
    if (base64.length * 0.75 <= MAX_JPEG_BYTES) return base64;
    size = getImageSize(size.width, size.height, Math.max(size.width, size.height) * 0.8);
  }
  throw new Error('照片內容過大，請只拍攝名片範圍後再試一次。');
}

export async function imageFileToJpegBase64(file: File): Promise<string> {
  validateImageFile(file);
  const objectUrl = URL.createObjectURL(file);
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
