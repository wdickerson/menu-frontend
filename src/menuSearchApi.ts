import { MENU_SEARCH_API_URL } from './menuApi';

export const MAX_SEARCH_QUERY_LENGTH = 500;
export type PossibleMenu = {
  venue_identifier: string;
  menu_identifier: string;
  source_url: string;
  agent_instructions: string;
};

// Use the explicit source, never private extraction guidance. Unsafe or missing
// links are simply hidden rather than rejecting otherwise usable menu results.
export function menuSourceUrl(menu: PossibleMenu): string | null {
  try {
    const url = new URL(menu.source_url);
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && url.hostname && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function isPossibleMenu(value: unknown): value is PossibleMenu {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = ['venue_identifier', 'menu_identifier', 'source_url', 'agent_instructions'];
  return fields.every((field) => field in value && typeof value[field as keyof typeof value] === 'string');
}

export async function searchMenusOnline(query: string, signal: AbortSignal): Promise<PossibleMenu[]> {
  query = query.trim();
  if (!query || Array.from(query).length > MAX_SEARCH_QUERY_LENGTH) {
    throw new Error(`Describe the menu in 1–${MAX_SEARCH_QUERY_LENGTH} characters.`);
  }
  signal.throwIfAborted();
  const response = await fetch(MENU_SEARCH_API_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }), signal,
  });
  const data: unknown = await response.json().catch(() => null);
  signal.throwIfAborted();
  if (!response.ok) {
    const error = data && typeof data === 'object' && 'error' in data ? data.error : null;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (response.status === 422 && code === 'no_menu_found') return [];
    if (code === 'search_refused') throw new Error('This search could not be processed. Try a different menu description.');
    if (response.status === 504) throw new Error('Searching took too long. Please try again.');
    if (response.status === 503) throw new Error('The menu search service is currently unavailable. Please try again later.');
    throw new Error(`Menus could not be searched (HTTP ${response.status}). Please try again.`);
  }
  if (!data || typeof data !== 'object'
      || !('possible_menus' in data) || !Array.isArray(data.possible_menus)
      || !data.possible_menus.every(isPossibleMenu)) {
    throw new Error('The service returned invalid menu search results. Please try again.');
  }
  return data.possible_menus.map((menu: PossibleMenu) => ({
    venue_identifier: menu.venue_identifier.trim(), menu_identifier: menu.menu_identifier.trim(),
    source_url: menu.source_url.trim(),
    agent_instructions: menu.agent_instructions.trim(),
  }));
}