import assert from 'node:assert/strict';
import test from 'node:test';
import { getContainedImageRect, getImageSize, getObjectCoverCrop, getStillPhotoSettings, isStillCameraUnsupported, takeHighResolutionPhoto, validateImageFile } from '../utils/cardImage';

const closeTo = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} should equal ${expected}`);

test('landscape video in a tall viewport crops the visible guide, including page offsets', () => {
  const crop = getObjectCoverCrop(4000, 3000,
    { left: 40, top: 100, width: 400, height: 800 },
    { left: 80, top: 300, width: 320, height: 200 });
  closeTo(crop.x, 1400);
  closeTo(crop.y, 750);
  closeTo(crop.width, 1200);
  closeTo(crop.height, 750);
});

test('portrait video in a wide viewport accounts for the vertically hidden frame', () => {
  const crop = getObjectCoverCrop(3000, 4000,
    { left: 20, top: 60, width: 800, height: 400 },
    { left: 120, top: 100, width: 400, height: 240 });
  closeTo(crop.x, 375);
  closeTo(crop.y, 1400);
  closeTo(crop.width, 1500);
  closeTo(crop.height, 900);
});

test('a guide extending outside the viewport is clipped to the visible frame', () => {
  assert.deepEqual(getObjectCoverCrop(1000, 500,
    { left: 100, top: 100, width: 500, height: 250 },
    { left: 50, top: 50, width: 650, height: 350 }),
  { x: 0, y: 0, width: 1000, height: 500 });
});

test('unready frames and nonintersecting guides cannot create blank captures', () => {
  const viewport = { left: 0, top: 0, width: 100, height: 100 };
  assert.throws(() => getObjectCoverCrop(0, 100, viewport, viewport), /尚未準備好/);
  assert.throws(() => getObjectCoverCrop(100, 100, viewport, { ...viewport, left: 200 }), /取景框/);
  assert.throws(() => getObjectCoverCrop(100, 100, viewport, { ...viewport, left: NaN }), /位置/);
});

test('image resizing preserves portrait or landscape proportions without upscaling', () => {
  assert.deepEqual(getImageSize(4032, 3024), { width: 3200, height: 2400 });
  assert.deepEqual(getImageSize(3024, 4032), { width: 2400, height: 3200 });
  assert.deepEqual(getImageSize(640, 400), { width: 640, height: 400 });
  assert.deepEqual(getImageSize(1, 10000), { width: 1, height: 3200 });
  assert.throws(() => getImageSize(0, 100));
});

test('containing a landscape preview retains a 2040-pixel card crop', () => {
  const viewport = { left: 10, top: 68, width: 390, height: 528 };
  const frame = getContainedImageRect(2560, 1440, viewport);
  closeTo(frame.width, 390);
  closeTo(frame.height, 219.375);
  const width = Math.min(frame.width * 0.9, frame.height * 0.9 * 85 / 54);
  const height = width * 54 / 85;
  const guide = { left: frame.left + (frame.width - width) / 2, top: frame.top + (frame.height - height) / 2, width, height };
  const crop = getObjectCoverCrop(2560, 1440, frame, guide);
  closeTo(crop.width, 2040);
  closeTo(crop.height, 1296);
});

test('contained portrait images exclude side bars and preserve actual frame coordinates', () => {
  const frame = getContainedImageRect(1440, 2560, { left: 10, top: 68, width: 390, height: 528 });
  assert.deepEqual(frame, { left: 56.5, top: 68, width: 297, height: 528 });
  const crop = getObjectCoverCrop(1440, 2560, frame, frame);
  assert.deepEqual(crop, { x: 0, y: 0, width: 1440, height: 2560 });
});

test('still requests use available photo resolution while bounding very large sensor modes', () => {
  assert.deepEqual(getStillPhotoSettings({ imageWidth: { max: 4032 }, imageHeight: { max: 3024 } }), { imageWidth: 4032, imageHeight: 3024 });
  assert.deepEqual(getStillPhotoSettings({ imageWidth: { min: 640, max: 12000, step: 16 }, imageHeight: { min: 480, max: 9000, step: 16 } }), { imageWidth: 4800, imageHeight: 3600 });
  assert.equal(getStillPhotoSettings({ imageWidth: { max: NaN } }), undefined);
});

test('unsupported maximum settings retry a real still using camera defaults', async () => {
  const settings: unknown[] = [];
  const photo = new Blob(['sensor image'], { type: 'image/jpeg' });
  const result = await takeHighResolutionPhoto({
    getPhotoCapabilities: async () => ({ imageWidth: { max: 4032 }, imageHeight: { max: 3024 } }),
    takePhoto: async setting => {
      settings.push(setting);
      if (setting) throw new DOMException('Size pair unsupported', 'NotSupportedError');
      return photo;
    },
  });
  assert.equal(result, photo);
  assert.deepEqual(settings, [{ imageWidth: 4032, imageHeight: 3024 }, undefined]);
});

test('unavailable capability queries do not prevent full-frame still capture', async () => {
  const photo = new Blob(['sensor image']);
  assert.equal(await takeHighResolutionPhoto({ getPhotoCapabilities: async () => { throw new Error('No capabilities'); }, takePhoto: async () => photo }), photo);
});

test('a failed still capture remains an error, not a silent video downgrade', async () => {
  let attempts = 0;
  await assert.rejects(takeHighResolutionPhoto({ takePhoto: async () => { attempts++; throw new DOMException('Camera busy', 'NotReadableError'); } }), { name: 'NotReadableError' });
  assert.equal(attempts, 1);
  assert.equal(isStillCameraUnsupported(new DOMException('No still camera', 'NotSupportedError')), true);
  assert.equal(isStillCameraUnsupported(new Error('Camera busy')), false);
});

test('canceling while capabilities are pending never starts a late photograph', async () => {
  let finishCapabilities!: (value: {}) => void;
  let active = true;
  let photos = 0;
  const capture = takeHighResolutionPhoto({
    getPhotoCapabilities: () => new Promise(resolve => { finishCapabilities = resolve; }),
    takePhoto: async () => { photos++; return new Blob(); },
  }, () => active);
  active = false;
  finishCapabilities({});
  await assert.rejects(capture, /取消/);
  assert.equal(photos, 0);
});

test('a hanging capability query times out and cannot take a photo when it eventually resolves', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let finishCapabilities!: (value: {}) => void;
  let photos = 0;
  const capture = takeHighResolutionPhoto({
    getPhotoCapabilities: () => new Promise(resolve => { finishCapabilities = resolve; }),
    takePhoto: async () => { photos++; return new Blob(); },
  });
  const rejection = assert.rejects(capture, /逾時/);
  context.mock.timers.tick(12001);
  await rejection;
  finishCapabilities({});
  await Promise.resolve();
  assert.equal(photos, 0);
});

test('photo upload accepts common phone formats and files whose MIME is omitted', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif']) {
    assert.doesNotThrow(() => validateImageFile({ name: 'photo', type, size: 1024 }));
  }
  assert.doesNotThrow(() => validateImageFile({ name: 'Card.JPG', type: '', size: 1024 }));
});

test('empty, oversized or non-photo uploads are rejected before decoding', () => {
  assert.throws(() => validateImageFile({ name: 'photo.jpg', type: 'image/jpeg', size: 0 }), /空白檔案/);
  assert.throws(() => validateImageFile({ name: 'photo.jpg', type: 'image/jpeg', size: 26 * 1024 * 1024 }), /25 MB/);
  assert.throws(() => validateImageFile({ name: 'photo.jpg', type: 'text/html', size: 1024 }), /請選擇/);
  assert.throws(() => validateImageFile({ name: 'drawing.svg', type: 'image/svg+xml', size: 1024 }), /請選擇/);
});
