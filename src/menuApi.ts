import type { RestaurantMenu } from './data/menus';
import { isRestaurantMenu } from './menuLibrary';
import { readPhotoDimensions } from './photoDimensions';

const configuredApiUrl = import.meta.env.VITE_MENU_API_URL?.trim()
  || 'https://we8asbpr8l.execute-api.us-east-1.amazonaws.com/prod/menu_image_transcribe';

function operationUrl(operation: 'menu_image_transcribe' | 'menu_online_search') {
  const url = new URL(configuredApiUrl);
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/[^/]*$/, `/${operation}`);
  url.search = '';
  url.hash = '';
  return url.href;
}

// Both operations share the configured host/stage. Legacy /menus configuration
// is migrated as well, so existing local dotenv files keep working after upgrade.
export const MENU_API_URL = operationUrl('menu_image_transcribe');
export const MENU_SEARCH_API_URL = operationUrl('menu_online_search');
export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 4_500_000;
export const MAX_IMAGE_FILE_BYTES = 350_000;
export const MAX_SINGLE_IMAGE_BYTES = 900_000;

const ERROR_MESSAGES: Record<string, string> = {
  no_menu_found: 'No menu was found. Take clearer photos of the menu and try again.',
  illegible_text: 'The menu could not be read. Take clearer photos and try again.',
  transcription_refused: 'These photos could not be processed. Take different menu photos and try again.',
  request_too_large: 'These photos are too large. Remove an image and try again.',
  images_too_large: 'These photos are too large. Remove an image and try again.',
  openai_rate_limited: 'The menu service is busy. Please try again shortly.',
  openai_timeout: 'Reading the menu took too long. Try again with fewer images.',
  transcription_disabled: 'The menu service is currently unavailable. Please try again later.',
  api_not_configured: 'The menu service is currently unavailable. Please try again later.',
};

export async function postMenuImages(images: Blob[], signal: AbortSignal): Promise<RestaurantMenu> {
  if (images.length < 1 || images.length > MAX_IMAGES) {
    throw new Error(`Capture between 1 and ${MAX_IMAGES} images before loading the menu.`);
  }
  if (images.some((image) => image.type !== 'image/jpeg' || image.size === 0)) {
    throw new Error('A captured image is invalid. Remove it and capture it again.');
  }
  const maxFileBytes = images.length === 1 ? MAX_SINGLE_IMAGE_BYTES : MAX_IMAGE_FILE_BYTES;
  if (images.some((image) => image.size > maxFileBytes)) {
    throw new Error(`Each image must be ${maxFileBytes / 1000} KB or smaller. Remove the oversized image and capture it again.`);
  }
  if (images.reduce((total, image) => total + image.size, 0) > MAX_IMAGE_BYTES) {
    throw new Error('These photos are too large. Remove an image and try again.');
  }
  const body = new FormData();
  images.forEach((image, index) => body.append('images', image, `menu-${index + 1}.jpg`));
  // The browser supplies the multipart boundary. Do not set Content-Type manually.
  const response = await fetch(MENU_API_URL, { method: 'POST', body, signal });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data && typeof data === 'object' && 'error' in data ? data.error : null;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    throw new Error(typeof code === 'string' && ERROR_MESSAGES[code]
      ? ERROR_MESSAGES[code] : `The menu could not be loaded (HTTP ${response.status}). Please try again.`);
  }
  if (!isRestaurantMenu(data)) {
    throw new Error('The service returned an invalid menu. Please try again.');
  }
  return { restaurantName: data.restaurantName,
    sections: data.sections.map(({ name, items }) => ({ name, items: [...items] })) };
}

export const MAX_IMAGE_WIDTH = 1568;
export const MAX_IMAGE_HEIGHT = 1568;

function fitImageDimensions(width: number, height: number) {
  if (width <= MAX_IMAGE_WIDTH && height <= MAX_IMAGE_HEIGHT) return { width, height };
  // Assign the limiting dimension directly to avoid floating-point rounding
  // turning the exact 1568-pixel target into 1567 pixels.
  if (MAX_IMAGE_WIDTH / width <= MAX_IMAGE_HEIGHT / height) {
    return { width: MAX_IMAGE_WIDTH, height: Math.max(1, Math.floor(height * MAX_IMAGE_WIDTH / width)) };
  }
  return { width: Math.max(1, Math.floor(width * MAX_IMAGE_HEIGHT / height)), height: MAX_IMAGE_HEIGHT };
}

type PreparationTiming = { decodeMs: number; drawMs: number; encodeMs: number; attempts: number; decoder: 'bitmap' | 'image' };

export async function prepareMenuImage(file: Blob, signal?: AbortSignal, singleImage = false): Promise<Blob> {
  signal?.throwIfAborted();
  if (!file.size) throw new Error('This image is empty. Take another photo.');
  const started = performance.now();
  const timing: PreparationTiming = { decodeMs: 0, drawMs: 0, encodeMs: 0, attempts: 0, decoder: 'image' };
  let source: HTMLImageElement | null = null;
  let url: string | null = null;
  let bitmap: ImageBitmap | null = null;
  try {
    // JPEG metadata lets supporting browsers decode directly at upload size.
    // Unknown formats and unsupported bitmap options use normal image decoding.
    const dimensions = typeof createImageBitmap === 'function' ? await readPhotoDimensions(file) : null;
    signal?.throwIfAborted();
    if (dimensions) {
      const resized = fitImageDimensions(dimensions.width, dimensions.height);
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image',
          resizeWidth: resized.width,
          resizeHeight: resized.height, resizeQuality: 'high' });
        timing.decoder = 'bitmap';
      } catch {
        signal?.throwIfAborted(); // Fall back only for a decoding/capability error.
      }
    }
    if (!bitmap) {
      url = URL.createObjectURL(file);
      source = new Image();
      const image = source;
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { image.onload = null; image.onerror = null; signal?.removeEventListener('abort', abort); };
        const abort = () => { cleanup(); image.src = ''; reject(signal?.reason); };
        image.onload = () => { cleanup(); resolve(); };
        image.onerror = () => { cleanup(); reject(new Error('This image format could not be opened. Use a JPEG photo and try again.')); };
        signal?.addEventListener('abort', abort, { once: true });
        image.src = url!;
      });
    }
    signal?.throwIfAborted();
    timing.decodeMs = performance.now() - started;
    const decoded = bitmap ?? source!;
    return await compressMenuImage(decoded, bitmap?.width ?? source!.naturalWidth,
      bitmap?.height ?? source!.naturalHeight, timing, signal, singleImage);
  } finally {
    bitmap?.close();
    if (source) source.src = '';
    if (url) URL.revokeObjectURL(url);
    // Measurements contain timings only, never photo data or filenames.
    const ended = performance.now();
    performance.measure('menu-image:total', { start: started, end: ended });
    performance.measure('menu-image:decode', { start: started, duration: timing.decodeMs });
    performance.measure('menu-image:draw', { start: started, duration: timing.drawMs });
    performance.measure('menu-image:encode', { start: started, duration: timing.encodeMs });
    if (import.meta.env.DEV) console.debug('[menu-image preparation]', { ...timing, totalMs: ended - started });
  }
}

async function compressMenuImage(source: CanvasImageSource, width: number, height: number,
  timing: PreparationTiming, signal?: AbortSignal, singleImage = false): Promise<Blob> {
  if (!width || !height) throw new Error('This image has invalid dimensions. Take another photo.');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not prepare an image.');
  // Browser decoding applies EXIF orientation. Fit the entire photo inside
  // 1568 by 1568 without cropping, stretching, or enlarging it.
  const resized = fitImageDimensions(width, height);
  const maxFileBytes = singleImage ? MAX_SINGLE_IMAGE_BYTES : MAX_IMAGE_FILE_BYTES;
  let scale = 1;
  let quality = 0.88;
  let drawnWidth = 0;
  let drawnHeight = 0;
  const encode = async (quality: number): Promise<Blob> => {
    signal?.throwIfAborted();
    const encodeStarted = performance.now();
    const image = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob && blob.size > 0 ? resolve(blob)
        : reject(new Error('The image could not be prepared. Please try again.')), 'image/jpeg', quality);
    });
    timing.encodeMs += performance.now() - encodeStarted;
    timing.attempts++;
    signal?.throwIfAborted();
    return image;
  };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    signal?.throwIfAborted();
    const nextWidth = Math.max(1, Math.floor(resized.width * scale));
    const nextHeight = Math.max(1, Math.floor(resized.height * scale));
    // Quality-only retries reuse the resized pixels instead of decoding/drawing again.
    if (nextWidth !== drawnWidth || nextHeight !== drawnHeight) {
      const drawStarted = performance.now();
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      drawnWidth = nextWidth;
      drawnHeight = nextHeight;
      timing.drawMs += performance.now() - drawStarted;
    }
    const image = await encode(quality);
    if (image.size <= maxFileBytes) return image;
    // Single-photo submissions keep their exact fitted resolution; only JPEG
    // quality may fall. Never shrink them further to satisfy the byte limit.
    if (singleImage) quality = Math.max(0.05, quality - 0.1);
    else if (quality > 0.65) quality -= 0.1;
    else scale *= 0.8;
  }
  throw new Error(`This image could not be compressed to ${maxFileBytes / 1000} KB. Try taking another photo.`);
}