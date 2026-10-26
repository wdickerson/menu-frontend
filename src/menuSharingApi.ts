import type { RestaurantMenu } from './data/menus';
import { MENU_SHARE_API_URL } from './menuApi';
import { isRestaurantMenu } from './menuLibrary';
import { isSharedMenuId } from './sharedMenuId';

const MAX_SHARED_MENU_BYTES = 300_000;
const TOO_LARGE_MESSAGE = 'This menu is too large to share. Try sharing a smaller menu.';
const ERROR_MESSAGES: Record<number, string> = {
  404: 'This shared menu could not be found. Check the link or ask for a new one.',
  413: TOO_LARGE_MESSAGE,
  429: 'The menu sharing service is busy. Please try again shortly.',
  503: 'The menu sharing service is currently unavailable. Please try again later.',
  504: 'The menu sharing request took too long. Please try again.',
};

function projectMenu(menu: RestaurantMenu): RestaurantMenu {
  return { restaurantName: menu.restaurantName,
    sections: menu.sections.map(({ name, items }) => ({ name, items: [...items] })) };
}

async function requestSharedMenu(url: string, options: RequestInit, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(url, { ...options, signal });
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error('The menu sharing service could not be reached. Check your connection and try again.');
  }
  const data: unknown = await response.json().catch(() => null);
  signal.throwIfAborted();
  if (!response.ok) {
    const action = options.method === 'POST' ? 'shared' : 'loaded';
    throw new Error(ERROR_MESSAGES[response.status]
      ?? `The menu could not be ${action} (HTTP ${response.status}). Please try again.`);
  }
  return data;
}

export async function postSharedMenu(menu: RestaurantMenu, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  if (!isRestaurantMenu(menu)) throw new Error('This menu is invalid. Load a menu before sharing it.');
  const body = JSON.stringify(projectMenu(menu));
  if (new TextEncoder().encode(body).byteLength > MAX_SHARED_MENU_BYTES) throw new Error(TOO_LARGE_MESSAGE);
  const data = await requestSharedMenu(MENU_SHARE_API_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  }, signal);
  if (!data || typeof data !== 'object' || !('menu_id' in data) || !isSharedMenuId(data.menu_id)) {
    throw new Error('The service returned an invalid shared menu ID. Please try again.');
  }
  return data.menu_id;
}

export async function getSharedMenu(menuId: string, signal: AbortSignal): Promise<RestaurantMenu> {
  signal.throwIfAborted();
  if (!isSharedMenuId(menuId)) throw new Error('This shared menu link is invalid. Check the link or ask for a new one.');
  const data = await requestSharedMenu(`${MENU_SHARE_API_URL}/${menuId}`, { method: 'GET' }, signal);
  if (!isRestaurantMenu(data) || !isSharedMenuId(data.sharedMenuId) || data.sharedMenuId !== menuId) {
    throw new Error('The service returned an invalid shared menu. Check the link or try again.');
  }
  return { ...projectMenu(data), sharedMenuId: data.sharedMenuId };
}