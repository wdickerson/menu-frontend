import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RestaurantMenu } from './data/menus';
import MenuSharing from './MenuSharing';
import { postSharedMenu } from './menuSharingApi';

vi.mock('./menuSharingApi', () => ({ postSharedMenu: vi.fn() }));

const menu: RestaurantMenu = { restaurantName: 'Cafe', sections: [{ name: 'Dinner', items: ['Soup $8'] }] };
const sharedMenuId = 'AbCdEf0123_-xy';

function expectInitialMarkup(html: string) {
  expect(html.match(/<button\b/g)).toHaveLength(1);
  expect(html).toMatch(/<button[^>]*type="button"[^>]*>Share This Menu<\/button>/);
  expect(html).not.toMatch(/<(?:input|textarea|label|select|form|a|p)\b/i);
  expect(html).not.toMatch(/copy\s+link/i);
  expect(html).not.toContain('Menu sharing link');
  expect(html).not.toContain('shared-menu-link');
  expect(html).not.toContain('role="status"');
  expect(html).not.toContain('role="alert"');
  expect(html).not.toContain('Share link copied to clipboard.');
  expect(html.replace(/<[^>]*>/g, '')).toBe('Share This Menu');
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('explicit Share This Menu control', () => {
  it.each([
    { label: 'a loaded unshared menu', menu, disabled: false, enabled: true },
    { label: 'a menu with an existing shared ID', menu: { ...menu, sharedMenuId }, disabled: false, enabled: true },
    { label: 'no selected menu', menu: null, disabled: false, enabled: false },
    { label: 'a loaded menu during other processing', menu, disabled: true, enabled: false },
    { label: 'an already-shared menu during other processing', menu: { ...menu, sharedMenuId }, disabled: true, enabled: false },
    { label: 'no menu during other processing', menu: null, disabled: true, enabled: false },
  ])('renders the correctly enabled non-submit button for $label without starting work', ({ menu: selected, disabled, enabled }) => {
    const nativeShare = vi.fn<() => Promise<void> | null>().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share: nativeShare, clipboard: { writeText } });
    const onShared = vi.fn(() => true);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const html = renderToStaticMarkup(<MenuSharing menu={selected} disabled={disabled} onShared={onShared} />);
    expectInitialMarkup(html);
    expect(html.includes('disabled=""')).toBe(!enabled);
    expect(postSharedMenu).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(nativeShare).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(onShared).not.toHaveBeenCalled();
  });

  it('does not create links or POST automatically across repeated renders or a menu change', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const onShared = vi.fn(() => true);
    for (const selected of [menu, menu, { ...menu, restaurantName: 'Another Cafe' }, { ...menu, sharedMenuId }, null]) {
      const html = renderToStaticMarkup(<MenuSharing menu={selected} disabled={false} onShared={onShared} />);
      expectInitialMarkup(html);
      expect(html).not.toContain('Preparing your share link');
      expect(html).not.toContain('Opening sharing options');
      expect(html).not.toContain('https://menu.littleapp.io/');
    }
    expect(postSharedMenu).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(onShared).not.toHaveBeenCalled();
  });

  it('renders safely without navigator or a native share implementation', () => {
    vi.stubGlobal('navigator', undefined);
    const onShared = vi.fn(() => true);
    const html = renderToStaticMarkup(<MenuSharing menu={menu} disabled={false} onShared={onShared} />);
    expectInitialMarkup(html);
    expect(html).toContain('type="button">Share This Menu</button>');
    expect(postSharedMenu).not.toHaveBeenCalled();
    expect(onShared).not.toHaveBeenCalled();
  });
});