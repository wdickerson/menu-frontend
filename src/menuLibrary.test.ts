import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addRecentMenu, getMenuChoices, getSelectedMenu, isRestaurantMenu, loadMenuLibrary,
  saveMenuLibrary } from './menuLibrary';

const menu = { restaurantName: 'Captured Cafe', sections: [{ name: 'Drinks', items: ['Tea 4'] }] };
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
});
afterEach(() => vi.unstubAllGlobals());

describe('menu library', () => {
  it('preserves the legacy restaurant selection', () => {
    storage.set('menu-reader.restaurantId', 'twilight');
    expect(getSelectedMenu(loadMenuLibrary()).restaurantName).toBe('Twilight');
  });

  it('saves the returned menu and selection across reloads alongside the examples', () => {
    const library = addRecentMenu(loadMenuLibrary(), menu);
    expect(saveMenuLibrary(library)).toBe(true);
    const restored = loadMenuLibrary();
    expect(getSelectedMenu(restored)).toEqual(menu);
    expect(getMenuChoices(restored).map(({ menu }) => menu.restaurantName))
      .toEqual(['Captured Cafe', 'Rough & Tumble', 'Twilight']);
  });

  it('keeps the most recent ten captures, including separate menus with the same name', () => {
    let library = loadMenuLibrary();
    for (let index = 0; index < 12; index += 1) library = addRecentMenu(library, menu);
    expect(library.recentMenus).toHaveLength(10);
    expect(new Set(library.recentMenus.map(({ id }) => id)).size).toBe(10);
    expect(library.selectedId).toBe(library.recentMenus[0].id);
  });

  it('falls back safely from corrupt or incompatible storage', () => {
    for (const value of ['{broken', 'null', '[]', '{"recentMenus":[null,7],"selectedId":"missing"}']) {
      storage.set('menu-reader.menuLibrary', value);
      expect(loadMenuLibrary()).toEqual({ selectedId: 'rough-and-tumble', recentMenus: [] });
    }
  });

  it('discards invalid and duplicate captures and stale selections', () => {
    const library = addRecentMenu(loadMenuLibrary(), menu);
    library.recentMenus.push(library.recentMenus[0]);
    library.recentMenus.push({ id: 'captured-invalid', capturedAt: 'invalid', menu });
    library.selectedId = 'captured-missing';
    saveMenuLibrary(library);
    expect(loadMenuLibrary().recentMenus).toHaveLength(1);
    expect(loadMenuLibrary().selectedId).toBe('rough-and-tumble');
  });

  it('reports storage failures without breaking the in-memory menu', () => {
    vi.stubGlobal('window', { localStorage: {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('quota'); },
    } });
    const library = addRecentMenu(loadMenuLibrary(), menu);
    expect(saveMenuLibrary(library)).toBe(false);
    expect(getSelectedMenu(library)).toEqual(menu);
  });

  it('rejects menus that cannot be safely navigated', () => {
    for (const invalid of [null, {}, { ...menu, restaurantName: '' }, { ...menu, sections: [] },
      { ...menu, sections: [null] }, { ...menu, sections: [{ name: 'Food', items: [] }] },
      { ...menu, sections: [{ name: 'Food', items: [42] }] }]) {
      expect(isRestaurantMenu(invalid)).toBe(false);
    }
    expect(isRestaurantMenu({ ...menu, isDummy: false })).toBe(true);
  });
});