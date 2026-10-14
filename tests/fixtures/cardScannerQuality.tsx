import React from 'react';
import { createRoot } from 'react-dom/client';
import CardScanner from '../../components/CardScanner';
import * as cardImage from '../../utils/cardImage';

// A standalone browser fixture: synthetic camera only, no application data or API.
const scope = window as any;
scope.cardImage = cardImage;
scope.captures = [];
scope.stillCalls = [];
scope.pendingPhotos = [];
scope.pendingCapabilities = [];
scope.behavior = 'photo';
scope.photoWidth = 4032;
scope.photoHeight = 3024;
scope.previewWidth = 640;
scope.previewHeight = 480;
scope.makePhoto = async (orientation = 1, noise = false) => {
  const canvas = document.createElement('canvas');
  canvas.width = scope.photoWidth;
  canvas.height = scope.photoHeight;
  const context = canvas.getContext('2d')!;
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (noise) {
    const pixels = context.createImageData(canvas.width, canvas.height);
    let seed = 1;
    for (let index = 0; index < pixels.data.length; index += 4) {
      for (let channel = 0; channel < 3; channel++) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        pixels.data[index + channel] = seed & 255;
      }
      pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
  }
  context.fillStyle = 'red'; context.fillRect(0, 0, 400, 400);
  context.fillStyle = 'lime'; context.fillRect(canvas.width - 400, 0, 400, 400);
  context.fillStyle = 'blue'; context.fillRect(0, canvas.height - 400, 400, 400);
  context.fillStyle = 'yellow'; context.fillRect(canvas.width - 400, canvas.height - 400, 400, 400);
  context.font = '80px sans-serif';
  context.fillStyle = 'black';
  context.fillText('Synthetic high-resolution business card', 500, 600);
  const photo = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/jpeg', 0.98));
  if (orientation === 1) return photo;
  const bytes = new Uint8Array(await photo.arrayBuffer());
  const exif = new Uint8Array([0xff, 0xe1, 0x00, 0x22, 69, 120, 105, 102, 0, 0, 0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0]);
  return new Blob([bytes.slice(0, 2), exif, bytes.slice(2)], { type: 'image/jpeg' });
};

const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia = async () => {
  const stream = await originalGetUserMedia({ audio: false, video: { width: { exact: scope.previewWidth }, height: { exact: scope.previewHeight } } });
  scope.lastStream = stream;
  return stream;
};

class SyntheticStillCamera {
  getPhotoCapabilities() {
    if (scope.behavior === 'pending-capabilities') return new Promise(resolve => scope.pendingCapabilities.push(resolve));
    return Promise.resolve({ imageWidth: { min: 640, max: scope.photoWidth, step: 1 }, imageHeight: { min: 480, max: scope.photoHeight, step: 1 } });
  }
  async takePhoto(settings: unknown) {
    scope.stillCalls.push(settings);
    if (scope.behavior === 'unsupported') throw new DOMException('Synthetic unsupported stills', 'NotSupportedError');
    if (scope.behavior === 'error') throw new DOMException('Synthetic busy camera', 'NotReadableError');
    if (scope.behavior === 'pending-photo') return new Promise(resolve => scope.pendingPhotos.push(resolve));
    return scope.makePhoto(scope.behavior === 'rotated' ? 6 : 1, scope.behavior === 'noise');
  }
}
scope.useStillCamera = (enabled: boolean) => { scope.ImageCapture = enabled ? SyntheticStillCamera : undefined; };
scope.useStillCamera(true);

const root = createRoot(document.getElementById('root')!);
let key = 0;
scope.showScanner = () => root.render(<CardScanner key={++key} isConfigError={false} onCaptureAndProcess={image => scope.captures.push(image)} onFinish={() => root.render(null)} />);
scope.hideScanner = () => root.render(null);
scope.inspectLastImage = async () => {
  const base64 = scope.captures.at(-1);
  const image = new Image();
  image.src = `data:image/jpeg;base64,${base64}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d')!;
  context.drawImage(image, 0, 0);
  const pixel = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data).slice(0, 3);
  return {
    width: canvas.width, height: canvas.height, bytes: base64.length * 0.75,
    topLeft: pixel(30, 30), topRight: pixel(canvas.width - 30, 30),
    bottomLeft: pixel(30, canvas.height - 30), bottomRight: pixel(canvas.width - 30, canvas.height - 30),
  };
};
scope.showScanner();
