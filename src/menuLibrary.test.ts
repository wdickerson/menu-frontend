import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addRecentMenu, deleteRecentMenu, getMenuChoices, getSelectedMenu, isRestaurantMenu,
  loadMenuLibrary, renameRecentMenu, saveMenuLibrary } from './menuLibrary';

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
  it('initializes first-time visitors with a persisted, ordinary sample menu', () => {
    const library = loadMenuLibrary();
    expect(getMenuChoices(library).map(({ menu }) => menu.restaurantName))
      .toEqual(['Rough & Tumble (Sample Menu)']);
    expect(getSelectedMenu(library)).toBe(library.recentMenus[0].menu);
    expect(saveMenuLibrary(library)).toBe(true);
    expect(loadMenuLibrary()).toEqual(library);
  });

  it('does not seed a sample for existing visitors with legacy selections', () => {
    storage.set('menu-reader.restaurantId', 'twilight');
    expect(loadMenuLibrary()).toEqual({ selectedId: '', recentMenus: [] });
    storage.set('menu-reader.restaurantId', 'rough-and-tumble');
    expect(getMenuChoices(loadMenuLibrary())).toEqual([]);
  });

  it('saves the returned menu and selection across reloads alongside the sample', () => {
    const library = addRecentMenu(loadMenuLibrary(), menu);
    expect(saveMenuLibrary(library)).toBe(true);
    const restored = loadMenuLibrary();
    expect(getSelectedMenu(restored)).toEqual(menu);
    expect(getMenuChoices(restored).map(({ menu }) => menu.restaurantName))
      .toEqual(['Captured Cafe', 'Rough & Tumble (Sample Menu)']);
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
      expect(loadMenuLibrary()).toEqual({ selectedId: '', recentMenus: [] });
    }
  });

  it('discards invalid and duplicate captures and stale selections', () => {
    const library = addRecentMenu(loadMenuLibrary(), menu);
    library.recentMenus.push(library.recentMenus[0]);
    library.recentMenus.push({ id: 'captured-invalid', capturedAt: 'invalid', menu });
    library.selectedId = 'captured-missing';
    saveMenuLibrary(library);
    expect(loadMenuLibrary().recentMenus).toHaveLength(2);
    expect(loadMenuLibrary().selectedId).toBe(library.recentMenus[0].id);
  });

  it('migrates existing captures without injecting examples or keeping a Twilight selection', () => {
    const existing = addRecentMenu({ selectedId: '', recentMenus: [] }, menu);
    saveMenuLibrary({ ...existing, selectedId: 'twilight' });
    expect(loadMenuLibrary()).toEqual(existing);
    saveMenuLibrary({ selectedId: 'rough-and-tumble', recentMenus: [] });
    expect(loadMenuLibrary()).toEqual({ selectedId: '', recentMenus: [] });
  });

  it('renames menus without changing their identities, contents, order, or timestamps', () => {
    const original = addRecentMenu(loadMenuLibrary(), menu);
    const id = original.recentMenus[0].id;
    const renamed = renameRecentMenu(original, id, '  New Cafe  ');
    expect(renamed.selectedId).toBe(id);
    expect(renamed.recentMenus[0]).toEqual({ ...original.recentMenus[0],
      menu: { ...menu, restaurantName: 'New Cafe' } });
    expect(original.recentMenus[0].menu.restaurantName).toBe('Captured Cafe');
    expect(renamed.recentMenus[1]).toBe(original.recentMenus[1]);
    saveMenuLibrary(renamed);
    expect(getSelectedMenu(loadMenuLibrary())?.restaurantName).toBe('New Cafe');
    expect(renameRecentMenu(renamed, id, '  ')).toBe(renamed);
  });

  it('does not restore a renamed sample or re-add it after deletion and reload', () => {
    const original = loadMenuLibrary();
    const renamed = renameRecentMenu(original, original.selectedId, 'My Sample');
    saveMenuLibrary(renamed);
    expect(getMenuChoices(loadMenuLibrary()).map(({ menu }) => menu.restaurantName)).toEqual(['My Sample']);
    saveMenuLibrary(deleteRecentMenu(renamed, renamed.selectedId));
    expect(loadMenuLibrary()).toEqual({ selectedId: '', recentMenus: [] });
    expect(getSelectedMenu(loadMenuLibrary())).toBeNull();
    storage.clear();
    expect(getSelectedMenu(loadMenuLibrary())?.restaurantName).toBe('Rough & Tumble (Sample Menu)');
  });

  it('deletes only the specified menu and clears the selection when deleting the loaded menu', () => {
    const first = addRecentMenu(loadMenuLibrary(), menu);
    const library = addRecentMenu(first, menu);
    const deleteOther = deleteRecentMenu(library, first.selectedId);
    expect(deleteOther.selectedId).toBe(library.selectedId);
    expect(deleteOther.recentMenus.map(({ id }) => id)).not.toContain(first.selectedId);
    const deleteSelected = deleteRecentMenu(library, library.selectedId);
    expect(deleteSelected.selectedId).toBe('');
    expect(deleteSelected.recentMenus).toEqual(first.recentMenus);
    expect(getSelectedMenu(deleteSelected)).toBeNull();
    saveMenuLibrary(deleteSelected);
    expect(loadMenuLibrary()).toEqual(deleteSelected);
    expect(getSelectedMenu(loadMenuLibrary())).toBeNull();
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

  it.each([
    { sections: [{ name: 'Hours', items: [] }] },
    { sections: [{ name: '', items: [] }, ...menu.sections, { name: 'Hours', items: [] }] },
    { sections: [{ name: '', items: ['Tea 4'] }] },
  ])('accepts and persists empty sections and blank headings: $sections', ({ sections }) => {
    const withEmptySections = { ...menu, sections };
    expect(isRestaurantMenu(withEmptySections)).toBe(true);
    const library = addRecentMenu(loadMenuLibrary(), withEmptySections);
    expect(saveMenuLibrary(library)).toBe(true);
    expect(getSelectedMenu(loadMenuLibrary())).toEqual(withEmptySections);
  });

  it('rejects menus that cannot be safely navigated', () => {
    for (const invalid of [null, {}, { ...menu, restaurantName: '' }, { ...menu, sections: [] },
      { ...menu, sections: [null] }, { ...menu, sections: [{ name: null, items: [] }] },
      { ...menu, sections: [{ name: 'Food', items: null }] },
      { ...menu, sections: [{ name: 'Food', items: [' '] }] },
      { ...menu, sections: [{ name: 'Food', items: [42] }] }]) {
      expect(isRestaurantMenu(invalid)).toBe(false);
    }
    expect(isRestaurantMenu({ ...menu, isDummy: false })).toBe(true);
  });
});