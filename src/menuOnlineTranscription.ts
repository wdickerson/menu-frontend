import type { RestaurantMenu } from './data/menus';
import { MENU_ONLINE_TRANSCRIBE_API_URL } from './menuApi';
import { isRestaurantMenu } from './menuLibrary';
import { MAX_SEARCH_QUERY_LENGTH, type PossibleMenu } from './menuSearchApi';

export async function postOnlineMenu(query: string, menu: PossibleMenu, signal: AbortSignal): Promise<RestaurantMenu> {
  query = query.trim();
  if (!query || Array.from(query).length > MAX_SEARCH_QUERY_LENGTH) {
    throw new Error('The original search query is missing or too long. Search for the menu again.');
  }
  signal.throwIfAborted();
  const body = JSON.stringify({ query, menu: {
    venue_identifier: menu.venue_identifier, menu_identifier: menu.menu_identifier,
    source_url: menu.source_url, agent_instructions: menu.agent_instructions,
  } });
  if (new TextEncoder().encode(body).byteLength > 65_536) {
    throw new Error('This menu result is too large to submit. Search again or choose another match.');
  }
  const response = await fetch(MENU_ONLINE_TRANSCRIBE_API_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal,
  });
  const data: unknown = await response.json().catch(() => null);
  signal.throwIfAborted();
  if (!response.ok) {
    const error = data && typeof data === 'object' && 'error' in data ? data.error : null;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (code === 'no_menu_found') throw new Error('The selected online menu could not be found or accessed. Try another match.');
    if (code === 'illegible_text') throw new Error('The selected menu could not be read. Try another match or capture photos.');
    if (response.status === 504) throw new Error('Reading the online menu took too long. Please try again.');
    if (response.status === 503) throw new Error('The menu service is currently unavailable. Please try again later.');
    throw new Error(`The online menu could not be loaded (HTTP ${response.status}). Please try again.`);
  }
  if (!isRestaurantMenu(data)) throw new Error('The service returned an invalid menu. Please try again.');
  return { restaurantName: data.restaurantName,
    sections: data.sections.map(({ name, items }) => ({ name, items: [...items] })) };
}