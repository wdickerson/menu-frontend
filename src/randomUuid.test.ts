import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUuid } from './randomUuid';
import { createAppNavigation } from './appNavigation';
import { ImagePreparationQueue } from './imagePreparationQueue';
import { addRecentMenu } from './menuLibrary';

const browserCrypto = globalThis.crypto;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function useHttpCrypto() {
  vi.stubGlobal('crypto', { getRandomValues: browserCrypto.getRandomValues.bind(browserCrypto) });
}

afterEach(() => vi.unstubAllGlobals());

describe('local UUID generation', () => {
  it('uses native randomUUID with its crypto receiver when available', () => {
    const nativeCrypto = {
      randomUUID: vi.fn(function (this: unknown) {
        expect(this).toBe(nativeCrypto);
        return '12345678-1234-4234-8234-123456789abc';
      }),
    };
    vi.stubGlobal('crypto', nativeCrypto);
    expect(randomUuid()).toBe('12345678-1234-4234-8234-123456789abc');
    expect(nativeCrypto.randomUUID).toHaveBeenCalledOnce();
  });

  it.each([0, 255])('sets UUID v4 version and variant bits for random bytes filled with %s', (value) => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(value));
    vi.stubGlobal('crypto', { getRandomValues });
    const id = randomUuid();
    expect(id).toMatch(uuidPattern);
    expect(id).toBe(value === 0
      ? '00000000-0000-4000-8000-000000000000'
      : 'ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(getRandomValues.mock.calls[0][0]).toHaveLength(16);
  });

  it('generates distinct IDs without randomUUID on HTTP origins', () => {
    useHttpCrypto();
    const ids = Array.from({ length: 100 }, randomUuid);
    expect(ids.every((id) => uuidPattern.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('initializes navigation, queues photos, and saves menus without randomUUID', async () => {
    useHttpCrypto();
    const browser = {
      history: { state: null, replaceState: vi.fn(), pushState: vi.fn(), back: vi.fn(), go: vi.fn() },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const navigation = createAppNavigation(browser as unknown as Window, vi.fn());
    expect(browser.history.replaceState).toHaveBeenCalledWith({
      menuReaderNavigation: { session: expect.stringMatching(uuidPattern), depth: 0, route: { screen: 'menu' } },
    }, '');
    navigation.dispose();

    const queue = new ImagePreparationQueue(async (file) => file);
    const image = queue.add(new Blob(['photo']));
    expect(image.id).toMatch(uuidPattern);
    expect((await image.result).blob).toBeInstanceOf(Blob);
    queue.dispose();

    const menu = { restaurantName: 'Test Menu', sections: [{ name: 'Lunch', items: ['Soup'] }] };
    const library = addRecentMenu({ selectedId: '', recentMenus: [] }, menu);
    expect(library.selectedId.slice('captured-'.length)).toMatch(uuidPattern);
    expect(library.recentMenus[0]).toMatchObject({ id: library.selectedId, menu });
  });
});