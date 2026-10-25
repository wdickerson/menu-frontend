import { restaurantMenus, type RestaurantMenu } from './data/menus';

export type RecentMenu = { id: string; capturedAt: string; menu: RestaurantMenu };
export type MenuLibrary = { selectedId: string; recentMenus: RecentMenu[] };
const LIBRARY_KEY = 'menu-reader.menuLibrary';
const MAX_RECENT_MENUS = 10;
const SAMPLE_ID = 'sample-rough-and-tumble';

export function isRestaurantMenu(value: unknown): value is RestaurantMenu {
  if (!value || typeof value !== 'object') return false;
  const menu = value as Partial<RestaurantMenu>;
  return typeof menu.restaurantName === 'string' && menu.restaurantName.trim().length > 0
    && Array.isArray(menu.sections) && menu.sections.length > 0
    && menu.sections.every((section) => section && typeof section.name === 'string'
      && Array.isArray(section.items)
      && section.items.every((item: unknown) => typeof item === 'string' && item.trim().length > 0));
}

export function getMenuChoices(library: MenuLibrary) {
  return library.recentMenus;
}

export function getSelectedMenu(library: MenuLibrary): RestaurantMenu | null {
  return getMenuChoices(library).find(({ id }) => id === library.selectedId)?.menu
    ?? null;
}

export function loadMenuLibrary(): MenuLibrary {
  const fallback: MenuLibrary = { selectedId: '', recentMenus: [] };
  try {
    const raw = window.localStorage.getItem(LIBRARY_KEY);
    if (raw === null) {
      const legacyId = window.localStorage.getItem('menu-reader.restaurantId');
      // Existing visitors do not receive a new sample when upgrading.
      if (legacyId !== null) return fallback;
      return { selectedId: SAMPLE_ID, recentMenus: [{ id: SAMPLE_ID,
        capturedAt: new Date().toISOString(),
        menu: { ...restaurantMenus['rough-and-tumble'], restaurantName: 'Rough & Tumble (Sample Menu)' },
      }] };
    }
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return fallback;
    const { selectedId, recentMenus } = saved as Partial<MenuLibrary>;
    if (!Array.isArray(recentMenus)) return fallback;
    const ids = new Set<string>();
    const validRecentMenus = recentMenus.filter((entry): entry is RecentMenu => {
      if (!entry || typeof entry.id !== 'string'
        || (!entry.id.startsWith('captured-') && entry.id !== SAMPLE_ID)
        || ids.has(entry.id) || typeof entry.capturedAt !== 'string'
        || !Number.isFinite(Date.parse(entry.capturedAt)) || !isRestaurantMenu(entry.menu)) return false;
      ids.add(entry.id);
      return true;
    }).slice(0, MAX_RECENT_MENUS);
    const library = { selectedId: typeof selectedId === 'string' ? selectedId : fallback.selectedId,
      recentMenus: validRecentMenus };
    if (library.selectedId !== '' && !getMenuChoices(library).some(({ id }) => id === library.selectedId)) {
      library.selectedId = library.recentMenus[0]?.id ?? '';
    }
    return library;
  } catch {
    return fallback;
  }
}

export function addRecentMenu(library: MenuLibrary, menu: RestaurantMenu): MenuLibrary {
  const entry = { id: `captured-${crypto.randomUUID()}`, capturedAt: new Date().toISOString(), menu };
  return { selectedId: entry.id, recentMenus: [entry, ...library.recentMenus].slice(0, MAX_RECENT_MENUS) };
}

export function renameRecentMenu(library: MenuLibrary, id: string, name: string): MenuLibrary {
  const restaurantName = name.trim();
  if (!restaurantName) return library;
  return { ...library, recentMenus: library.recentMenus.map((entry) => entry.id === id
    ? { ...entry, menu: { ...entry.menu, restaurantName } } : entry) };
}

export function deleteRecentMenu(library: MenuLibrary, id: string): MenuLibrary {
  const recentMenus = library.recentMenus.filter((entry) => entry.id !== id);
  return { selectedId: library.selectedId === id ? '' : library.selectedId,
    recentMenus };
}

export function saveMenuLibrary(library: MenuLibrary): boolean {
  try {
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
    return true;
  } catch {
    return false;
  }
}