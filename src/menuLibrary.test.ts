import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addRecentMenu, deleteRecentMenu, getMenuChoices, getSelectedMenu, isRestaurantMenu,
  loadMenuLibrary, renameRecentMenu, saveMenuLibrary, setSharedMenuId } from './menuLibrary';

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

  it('attaches and persists a reusable sharing ID without changing local entry metadata or selection', () => {
    const original = addRecentMenu(loadMenuLibrary(), menu);
    const library = { ...original, selectedId: original.recentMenus[1].id };
    const entry = library.recentMenus[0];
    const sharedMenuId = 'AbCdEf0123_-xy';
    const shared = setSharedMenuId(library, entry.id, entry.menu, sharedMenuId);
    expect(shared).not.toBe(library);
    expect(shared.selectedId).toBe(library.selectedId);
    expect(shared.recentMenus.map(({ id }) => id)).toEqual(library.recentMenus.map(({ id }) => id));
    expect(shared.recentMenus[0]).toEqual({ ...entry, menu: { ...menu, sharedMenuId } });
    expect(shared.recentMenus[0].menu.sections).toBe(entry.menu.sections);
    expect(shared.recentMenus[1]).toBe(library.recentMenus[1]);
    expect(entry.menu).not.toHaveProperty('sharedMenuId');
    expect(setSharedMenuId(shared, entry.id, shared.recentMenus[0].menu, sharedMenuId)).toBe(shared);
    expect(saveMenuLibrary(shared)).toBe(true);
    const restored = loadMenuLibrary();
    expect(restored).toEqual(shared);
    expect(restored.recentMenus[0].id).toMatch(/^captured-/);
    expect(restored.recentMenus[0].menu.sharedMenuId).toBe(sharedMenuId);
    expect(JSON.parse(storage.get('menu-reader.menuLibrary')!).recentMenus[0].menu)
      .toEqual({ ...menu, sharedMenuId });
  });

  it('saves a recipient menu using a local captured ID while retaining its shared ID', () => {
    const received = { ...menu, sharedMenuId: 'AbCdEf0123_-xy' };
    const library = addRecentMenu(loadMenuLibrary(), received);
    expect(library.selectedId).toMatch(/^captured-/);
    expect(library.selectedId).not.toBe(received.sharedMenuId);
    saveMenuLibrary(library);
    expect(getSelectedMenu(loadMenuLibrary())).toEqual(received);
  });

  it.each(['  Renamed Cafe  ', 'Captured Cafe'])('strips the shared ID on a nonblank rename to %j', (name) => {
    const sharedMenu = { ...menu, sharedMenuId: 'AbCdEf0123_-xy' };
    const library = addRecentMenu(loadMenuLibrary(), sharedMenu);
    const entry = library.recentMenus[0];
    const renamed = renameRecentMenu(library, entry.id, name);
    expect(renamed.recentMenus[0]).toEqual({ ...entry, menu: { ...menu, restaurantName: name.trim() } });
    expect(renamed.recentMenus[0].menu).not.toHaveProperty('sharedMenuId');
    expect(renamed.recentMenus[0].menu.sections).toBe(sharedMenu.sections);
    expect(renamed.recentMenus[1]).toBe(library.recentMenus[1]);
    expect(renamed.selectedId).toBe(library.selectedId);
    expect(sharedMenu.sharedMenuId).toBe('AbCdEf0123_-xy');
    saveMenuLibrary(renamed);
    expect(getSelectedMenu(loadMenuLibrary())).not.toHaveProperty('sharedMenuId');
  });

  it('keeps the shared ID on blank renames and when deleting a different local menu', () => {
    const sharedMenu = { ...menu, sharedMenuId: 'AbCdEf0123_-xy' };
    const library = addRecentMenu(loadMenuLibrary(), sharedMenu);
    expect(renameRecentMenu(library, library.selectedId, ' \n ')).toBe(library);
    const deleted = deleteRecentMenu(library, library.recentMenus[1].id);
    expect(deleted.recentMenus[0]).toBe(library.recentMenus[0]);
    saveMenuLibrary(deleted);
    expect(getSelectedMenu(loadMenuLibrary())).toEqual(sharedMenu);
  });

  it.each(['', 'a'.repeat(13), 'a'.repeat(15), 'abcdefghijklm/', 'abcdefghijklm\n'])
    ('does not change the library for invalid sharing ID %j', (sharedMenuId) => {
      const library = addRecentMenu(loadMenuLibrary(), menu);
      expect(setSharedMenuId(library, library.selectedId, menu, sharedMenuId)).toBe(library);
    });

  it('ignores stale share results after rename, deletion, replacement, or a local ID mismatch', () => {
    const library = addRecentMenu(loadMenuLibrary(), menu);
    const id = library.selectedId;
    const sharedMenuId = 'AbCdEf0123_-xy';
    for (const current of [renameRecentMenu(library, id, 'Renamed'),
      renameRecentMenu(library, id, menu.restaurantName), deleteRecentMenu(library, id)]) {
      expect(setSharedMenuId(current, id, menu, sharedMenuId)).toBe(current);
    }
    expect(setSharedMenuId(library, id, { ...menu }, sharedMenuId)).toBe(library);
    expect(setSharedMenuId(library, library.recentMenus[1].id, menu, sharedMenuId)).toBe(library);
    expect(setSharedMenuId(library, 'captured-missing', menu, sharedMenuId)).toBe(library);
  });

  it.each([null, 42, {}, [], '', 'a'.repeat(13), 'a'.repeat(15), 'abcdefghijklm/',
    'abcdefghijklm\n'].map((sharedMenuId) => ({ sharedMenuId })))
    ('strips malformed persisted sharedMenuId $sharedMenuId without losing a usable menu', ({ sharedMenuId }) => {
      const library = addRecentMenu(loadMenuLibrary(), menu);
      storage.set('menu-reader.menuLibrary', JSON.stringify({ ...library,
        recentMenus: library.recentMenus.map((entry, index) => index === 0
          ? { ...entry, menu: { ...entry.menu, sharedMenuId } } : entry),
      }));
      const restored = loadMenuLibrary();
      expect(restored).toEqual(library);
      expect(getSelectedMenu(restored)).not.toHaveProperty('sharedMenuId');
      saveMenuLibrary(restored);
      expect(JSON.parse(storage.get('menu-reader.menuLibrary')!).recentMenus[0].menu)
        .not.toHaveProperty('sharedMenuId');
    });

  it('does not accept shared IDs as persisted local entry IDs', () => {
    const library = addRecentMenu(loadMenuLibrary(), { ...menu, sharedMenuId: 'AbCdEf0123_-xy' });
    saveMenuLibrary({ selectedId: 'AbCdEf0123_-xy', recentMenus: [
      { ...library.recentMenus[0], id: 'AbCdEf0123_-xy' },
    ] });
    expect(loadMenuLibrary()).toEqual({ selectedId: '', recentMenus: [] });
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