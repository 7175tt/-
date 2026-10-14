import assert from 'node:assert/strict';
import test from 'node:test';
import { getImageSize, getObjectCoverCrop, validateImageFile } from '../utils/cardImage';

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
  assert.deepEqual(getImageSize(4032, 3024), { width: 2000, height: 1500 });
  assert.deepEqual(getImageSize(3024, 4032), { width: 1500, height: 2000 });
  assert.deepEqual(getImageSize(640, 400), { width: 640, height: 400 });
  assert.deepEqual(getImageSize(1, 10000), { width: 1, height: 2000 });
  assert.throws(() => getImageSize(0, 100));
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
