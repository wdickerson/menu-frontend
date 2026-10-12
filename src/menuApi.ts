import type { RestaurantMenu } from './data/menus';
import { isRestaurantMenu } from './menuLibrary';

export const MENU_API_URL = 'https://we8asbpr8l.execute-api.us-east-1.amazonaws.com/prod/menus';
export const MAX_IMAGES = 10;
export const MAX_IMAGE_BYTES = 4_500_000;
export const MAX_IMAGE_FILE_BYTES = 250_000;

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
  if (images.some((image) => image.size > MAX_IMAGE_FILE_BYTES)) {
    throw new Error('Each image must be 250 KB or smaller. Remove the oversized image and capture it again.');
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

export async function captureMenuImage(video: HTMLVideoElement, zoom: number): Promise<Blob> {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error('The camera is not ready yet. Wait for the preview and try again.');
  }
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not capture an image.');
  const cropWidth = video.videoWidth / zoom;
  const cropHeight = video.videoHeight / zoom;
  let scale = Math.min(1, 2400 / Math.max(cropWidth, cropHeight));
  let quality = 0.88;
  // Bound each capture as well as the combined upload; retain useful text resolution.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    canvas.width = Math.max(1, Math.round(cropWidth * scale));
    canvas.height = Math.max(1, Math.round(cropHeight * scale));
    context.drawImage(video, (video.videoWidth - cropWidth) / 2,
      (video.videoHeight - cropHeight) / 2, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    const image = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob && blob.size > 0 ? resolve(blob)
        : reject(new Error('The image could not be captured. Please try again.')), 'image/jpeg', quality);
    });
    if (image.size <= MAX_IMAGE_FILE_BYTES) return image;
    if (quality > 0.65) quality -= 0.1;
    else scale *= 0.8;
  }
  throw new Error('This image could not be compressed to 250 KB. Try capturing a smaller portion of the menu.');
}