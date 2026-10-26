import { afterEach, describe, expect, it, vi } from 'vitest';
import { consumeSharedMenuLink, sharedMenuIdFromPath } from './sharedMenuLink';

const sharedMenuId = 'AbCdEf0123_-xy';

afterEach(() => vi.unstubAllGlobals());

describe('shared menu paths', () => {
  it.each(['/', '/menu/', '/menu'])('reads a valid fourteen-character ID immediately under base %j without fetching', (base) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const prefix = base.endsWith('/') ? base : `${base}/`;
    expect(sharedMenuIdFromPath(`${prefix}${sharedMenuId}`, base)).toBe(sharedMenuId);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['abcdefghijklmn', 'ABCDEFGHIJKLMN', '0123456789_-ab', '_'.repeat(14), '-'.repeat(14)])
    ('preserves case and URL-safe ID characters in %j', (id) => {
      expect(sharedMenuIdFromPath(`/${id}`, '/')).toBe(id);
      expect(sharedMenuIdFromPath(`/menu/${id}`, '/menu/')).toBe(id);
    });

  it.each([
    '', 'a'.repeat(13), 'a'.repeat(15), 'abcdefghijklm+', 'abcdefghijklm=',
    'abcdefghijklm ', 'abcdefghijklm\n', `${sharedMenuId}\n`, 'ébcdefghijklmn',
    '../abcdefghijk', 'abcd?efghijklm', 'abcd#efghijklm', '%41bCdEf0123_-xy',
    'abcdefghijk%2F', 'abcdefghijk%5C',
  ])('rejects the empty or invalid ID %j under both supported bases without fetching', (id) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(sharedMenuIdFromPath(`/${id}`, '/')).toBeNull();
    expect(sharedMenuIdFromPath(`/menu/${id}`, '/menu/')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { pathname: '', base: '/' },
    { pathname: '/', base: '/' },
    { pathname: '/menu', base: '/menu/' },
    { pathname: '/menu/', base: '/menu/' },
    { pathname: `/${sharedMenuId}/`, base: '/' },
    { pathname: `/${sharedMenuId}/extra`, base: '/' },
    { pathname: `/menu/${sharedMenuId}`, base: '/' },
    { pathname: `/menu/${sharedMenuId}/`, base: '/menu/' },
    { pathname: `/menu/${sharedMenuId}/extra`, base: '/menu/' },
    { pathname: `/menu//${sharedMenuId}`, base: '/menu/' },
    { pathname: `//${sharedMenuId}`, base: '/' },
    { pathname: `/other/${sharedMenuId}`, base: '/menu/' },
    { pathname: `/menus/${sharedMenuId}`, base: '/menu/' },
    { pathname: `/MENU/${sharedMenuId}`, base: '/menu/' },
    { pathname: `/${sharedMenuId}`, base: '/menu/' },
    { pathname: `/${sharedMenuId}`, base: '/menu' },
  ])('rejects a wrong or non-single-ID path $pathname for base $base without fetching', ({ pathname, base }) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(sharedMenuIdFromPath(pathname, base)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function browserAt(pathname: string, state: unknown, search: string, hash: string) {
  const location = new URL(`https://menu.littleapp.io${pathname}${search}${hash}`);
  const history = {
    state,
    replaceState: vi.fn((nextState: unknown, _unused: string, nextUrl?: string | URL | null) => {
      history.state = nextState;
      if (nextUrl != null) location.href = new URL(nextUrl, location).href;
    }),
    pushState: vi.fn(),
  };
  return { browser: { history, location } as unknown as Pick<Window, 'history' | 'location'>, history, location };
}

describe('consuming an incoming shared menu link', () => {
  it.each([
    { base: '/', search: '?keep=two%20words&repeat=1&repeat=2', hash: '#section%202' },
    { base: '/menu/', search: '?keep=two%20words&repeat=1&repeat=2', hash: '#section%202' },
    { base: '/', search: '', hash: '' },
    { base: '/menu/', search: '', hash: '#menu' },
    { base: '/menu/', search: '?keep=1', hash: '' },
  ])('replaces only the ID path with $base and preserves query $search and hash $hash', ({ base, search, hash }) => {
    const state = { unrelated: { value: 'preserved' }, menuReaderNavigation: { depth: 2, route: { screen: 'menu' } } };
    const test = browserAt(`${base}${sharedMenuId}`, state, search, hash);
    consumeSharedMenuLink(test.browser, base);
    expect(test.history.replaceState).toHaveBeenCalledExactlyOnceWith(state, '', `${base}${search}${hash}`);
    expect(test.history.replaceState.mock.calls[0][0]).toBe(state);
    expect(test.history.state).toBe(state);
    expect(test.history.pushState).not.toHaveBeenCalled();
    expect(test.location.pathname).toBe(base);
    expect(test.location.search).toBe(search);
    expect(test.location.hash).toBe(hash);
    expect(test.location.origin).toBe('https://menu.littleapp.io');
    expect(sharedMenuIdFromPath(test.location.pathname, base)).toBeNull();
  });

  it.each([null, 'existing history state', 0])('preserves non-object history state %j rather than replacing it with app state', (state) => {
    const test = browserAt(`/${sharedMenuId}`, state, '?keep=1', '#menu');
    consumeSharedMenuLink(test.browser, '/');
    expect(test.history.replaceState).toHaveBeenCalledExactlyOnceWith(state, '', '/?keep=1#menu');
    expect(test.history.state).toBe(state);
    expect(test.history.pushState).not.toHaveBeenCalled();
  });
});