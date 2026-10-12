import { imageDimensionsFromData } from 'image-dimensions';
import { MAX_PHOTO_BYTES } from './menuApi';

const MAX_SOURCE_BYTES = 40_000_000;
const MAX_SOURCE_PIXELS = 50_000_000;
const INITIAL_LONG_EDGE = 2560;

async function checkSourceDimensions(file: File) {
  // Inspect bounded metadata before allocating a bitmap. Compressed file size alone
  // does not protect a phone from huge panoramas or highly compressed PNG images.
  const header = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('This photo could not be opened. Please choose it again.'));
    reader.readAsArrayBuffer(file.slice(0, 512_000));
  });
  const dimensions = imageDimensionsFromData(new Uint8Array(header));
  if (dimensions && dimensions.width * dimensions.height > MAX_SOURCE_PIXELS) {
    throw new Error('This photo has too many pixels to prepare safely on a phone. Take a standard-resolution photo, or crop this photo into smaller parts.');
  }
}

type DecodedPhoto = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

async function decodePhoto(file: File): Promise<DecodedPhoto> {
  // Modern browsers apply EXIF orientation here, keeping portrait camera photos upright.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Safari and some photo formats need the HTMLImageElement decoder instead.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('This browser could not open the photo. Try taking a new photo, or choose a JPEG, PNG, or WebP image. For HEIC photos, export them as JPEG first.');
  }
}

function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob && blob.type === 'image/jpeg') resolve(blob);
      else reject(new Error('This browser could not prepare the photo. Please try a different photo or browser.'));
    }, 'image/jpeg', quality);
  });
}

export type PreparedMenuPhoto = { file: File; width: number; height: number };

export async function prepareMenuPhoto(file: File): Promise<PreparedMenuPhoto> {
  if (file.size === 0) throw new Error('This photo is empty. Please take it again.');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('This photo is too large to open. Please choose a photo smaller than 40 MB.');
  if ((file.type && !file.type.startsWith('image/')) || /\.(pdf|svg|gif)$/i.test(file.name)
    || ['image/svg+xml', 'image/gif'].includes(file.type)) {
    throw new Error('Please choose a still photo of the menu, not a document or animation. JPEG, PNG, and WebP work best.');
  }

  await checkSourceDimensions(file);
  const decoded = await decodePhoto(file);
  const canvas = document.createElement('canvas');
  try {
    if (decoded.width <= 0 || decoded.height <= 0) throw new Error('This photo could not be read. Please take it again.');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare photos. Please try a different browser.');
    const scale = Math.min(1, INITIAL_LONG_EDGE / Math.max(decoded.width, decoded.height));
    let width = Math.max(1, Math.round(decoded.width * scale));
    let height = Math.max(1, Math.round(decoded.height * scale));

    // Prefer preserving text resolution over very low JPEG quality. If needed, shrink
    // a little and retry. Every returned File is verified below the byte budget.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      canvas.width = width;
      canvas.height = height;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(decoded.source, 0, 0, width, height);
      for (const quality of [0.9, 0.8, 0.7, 0.6]) {
        const blob = await encodeJpeg(canvas, quality);
        if (blob.size > 0 && blob.size <= MAX_PHOTO_BYTES) {
          return { file: new File([blob], 'menu-photo.jpg', { type: 'image/jpeg' }), width, height };
        }
      }
      width = Math.max(1, Math.floor(width * 0.82));
      height = Math.max(1, Math.floor(height * 0.82));
    }
    throw new Error('This photo could not be reduced to 250 KB. Try photographing a smaller part of the menu.');
  } finally {
    decoded.release();
    // Release canvas memory, especially important when adding several phone photos.
    canvas.width = 0;
    canvas.height = 0;
  }
}