import type { RestaurantMenu } from './data/menus';

export const MENU_API_URL = 'https://we8asbpr8l.execute-api.us-east-1.amazonaws.com/prod/menus';
export const MAX_MENU_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 250_000;
const REQUEST_TIMEOUT_MS = 45_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonemptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// Also used when restoring a captured menu from untrusted localStorage.
export function parseRestaurantMenu(value: unknown): RestaurantMenu {
  if (!isRecord(value) || !isNonemptyText(value.restaurantName)
    || !Array.isArray(value.sections) || value.sections.length === 0) {
    throw new Error('The menu response is incomplete. Your photos are still here; please try again.');
  }

  return {
    restaurantName: value.restaurantName.trim(),
    sections: value.sections.map((section: unknown) => {
      if (!isRecord(section) || !isNonemptyText(section.name)
        || !Array.isArray(section.items) || section.items.length === 0
        || !section.items.every(isNonemptyText)) {
        throw new Error('The menu response is incomplete. Your photos are still here; please try again.');
      }

      return { name: section.name.trim(), items: section.items.map((item: string) => item.trim()) };
    }),
  };
}

const API_ERROR_MESSAGES: Record<string, string> = {
  no_menu_found: 'No menu was found. Retake the photos with the menu filling the frame, then try again.',
  illegible_text: 'The menu text could not be read. Retake the photos in good light, avoiding blur and glare.',
  transcription_refused: 'These photos could not be transcribed. Please try different photos of the menu.',
  invalid_image: 'A photo could not be read. Retake it or choose a different photo, then try again.',
  invalid_images: 'Please include between 1 and 10 menu photos.',
  unsupported_image_type: 'A photo format was not accepted. Retake it or choose a JPEG, PNG, or WebP photo.',
  images_too_large: 'The photos were too large for the service. Remove a photo and try again.',
  request_too_large: 'The request was too large for the service. Remove a photo and try again.',
  openai_rate_limited: 'The menu service is busy. Your photos are saved on this screen; try again shortly.',
  openai_timeout: 'Reading the menu took too long. Try again, or submit fewer, clearer photos.',
  incomplete_transcription: 'The service could not finish the menu. Try submitting fewer photos at once.',
  transcription_disabled: 'Menu capture is not available right now. Keep your photos here and try again later, or use an example menu.',
  api_not_configured: 'Menu capture is not available right now. Please try again later or use an example menu.',
  openai_not_funded: 'Menu capture is not available right now. Please try again later or use an example menu.',
  openai_authentication_failed: 'Menu capture is not available right now. Please try again later or use an example menu.',
};

function getApiErrorMessage(body: unknown, status: number) {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string') {
    const message = API_ERROR_MESSAGES[body.error.code];
    if (message) return message;
  }

  if (status === 413) return API_ERROR_MESSAGES.request_too_large;
  if (status === 429) return API_ERROR_MESSAGES.openai_rate_limited;
  if (status === 504) return API_ERROR_MESSAGES.openai_timeout;
  return 'The menu service could not read your photos right now. Your photos are still here; please try again.';
}

export async function submitMenuImages(images: readonly File[], signal: AbortSignal): Promise<RestaurantMenu> {
  if (images.length === 0 || images.length > MAX_MENU_PHOTOS) {
    throw new Error(API_ERROR_MESSAGES.invalid_images);
  }
  if (images.some((image) => image.size > MAX_PHOTO_BYTES || image.size === 0 || image.type !== 'image/jpeg')) {
    throw new Error('A photo is not ready for upload. Retake it or choose it again.');
  }

  const controller = new AbortController();
  const abortRequest = () => controller.abort();
  let timedOut = false;
  signal.addEventListener('abort', abortRequest, { once: true });
  if (signal.aborted) controller.abort();
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const form = new FormData();
    images.forEach((image, index) => form.append('images', image, `menu-page-${index + 1}.jpg`));
    // The browser supplies the multipart boundary. No credentials or model options are sent.
    const response = await fetch(MENU_API_URL, {
      method: 'POST',
      body: form,
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getApiErrorMessage(body, response.status));
    if (!isRecord(body) || body.isDummy !== false) {
      throw new Error('The service did not return a transcribed menu. Your photos are still here; please try again.');
    }
    return parseRestaurantMenu(body);
  } catch (error) {
    if (signal.aborted) throw new DOMException('Request canceled', 'AbortError');
    if (timedOut) {
      throw new Error('The connection timed out. Your photos are still here. Check your connection and try again; the service may already have received them.');
    }
    if (error instanceof TypeError) {
      throw new Error('Could not reach the menu service. Check your internet connection and try again. Your photos are still here.');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener('abort', abortRequest);
  }
}