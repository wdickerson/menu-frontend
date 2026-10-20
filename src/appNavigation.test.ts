import { describe, expect, it, vi } from 'vitest';
import { createAppNavigation, type AppRoute } from './appNavigation';

function createBrowser() {
  const events = new EventTarget();
  const entries: { state: unknown; url: string }[] = [
    { state: { unrelated: 'preserved' }, url: 'https://reader.example.test/app?keep=query#unchanged' },
  ];
  let index = 0;
  const history = {
    get state() { return entries[index].state; },
    get length() { return entries.length; },
    replaceState: vi.fn((state: unknown, _unused: string, url?: string | URL | null) => {
      entries[index] = { state: structuredClone(state),
        url: url == null ? entries[index].url : new URL(url, entries[index].url).href };
    }),
    pushState: vi.fn((state: unknown, _unused: string, url?: string | URL | null) => {
      const nextUrl = url == null ? entries[index].url : new URL(url, entries[index].url).href;
      entries.splice(index + 1);
      entries.push({ state: structuredClone(state), url: nextUrl });
      index += 1;
    }),
    go(delta: number) {
      const next = index + delta;
      if (next < 0 || next >= entries.length) return;
      index = next;
      events.dispatchEvent(new Event('popstate'));
    },
    back() { this.go(-1); },
    forward() { this.go(1); },
  };
  const browser = {
    history,
    location: { get href() { return entries[index].url; } },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  } as unknown as Window;
  return { browser, history };
}

describe('app browser navigation', () => {
  it.each(['quick-nav', 'selection', 'capture', 'search', 'search-results'] as const)('returns from %s to home with Back and restores it with Forward', (screen) => {
    const { browser, history } = createBrowser();
    const change = vi.fn();
    const navigation = createAppNavigation(browser, change);
    const route = { screen } as AppRoute;
    navigation.navigate(route);
    expect(change).toHaveBeenLastCalledWith(route);
    history.back();
    expect(change).toHaveBeenLastCalledWith({ screen: 'menu' });
    history.forward();
    expect(change).toHaveBeenLastCalledWith(route);
    navigation.dispose();
  });

  it('keeps home, search, and results as separate Back/Forward entries without changing the URL', () => {
    const { browser, history } = createBrowser();
    const originalUrl = browser.location.href;
    const change = vi.fn();
    const navigation = createAppNavigation(browser, change);
    const expectRoute = (screen: AppRoute['screen']) => {
      expect(change).toHaveBeenLastCalledWith({ screen });
      expect(history.state).toMatchObject({ menuReaderNavigation: { route: { screen } } });
      expect(browser.location.href).toBe(originalUrl);
    };
    expect(browser.location.href).toBe(originalUrl);
    navigation.navigate({ screen: 'search' });
    expectRoute('search');
    navigation.navigate({ screen: 'search-results' });
    expectRoute('search-results');
    expect(history.length).toBe(3);
    navigation.back();
    expectRoute('search');
    history.back();
    expectRoute('menu');
    history.forward();
    expectRoute('search');
    history.forward();
    expectRoute('search-results');
    navigation.home();
    expectRoute('menu');
    expect(history.length).toBe(3);
    expect(history.pushState.mock.calls.every((call) => call[2] == null)).toBe(true);
    expect(history.replaceState.mock.calls.every((call) => call[2] == null)).toBe(true);
    navigation.dispose();
  });

  it('drops stale results from the forward branch when another screen is opened after Back', () => {
    const { browser, history } = createBrowser();
    const originalUrl = browser.location.href;
    const change = vi.fn();
    const navigation = createAppNavigation(browser, change);
    navigation.navigate({ screen: 'search' });
    navigation.navigate({ screen: 'search-results' });
    navigation.back();
    navigation.navigate({ screen: 'capture' });
    expect(history.length).toBe(3);
    change.mockClear();
    history.forward();
    expect(change).not.toHaveBeenCalled();
    navigation.back();
    expect(change).toHaveBeenLastCalledWith({ screen: 'search' });
    history.forward();
    expect(change).toHaveBeenLastCalledWith({ screen: 'capture' });
    expect(browser.location.href).toBe(originalUrl);
    navigation.dispose();
  });

  it.each(['search', 'search-results'] as const)('refreshes %s to home without restoring old search routes', (screen) => {
    const { browser, history } = createBrowser();
    const originalUrl = browser.location.href;
    const first = createAppNavigation(browser, vi.fn());
    first.navigate({ screen: 'search' });
    first.navigate({ screen: 'search-results' });
    if (screen === 'search') first.back();
    const previousSession = (history.state as { menuReaderNavigation: { session: string } }).menuReaderNavigation.session;
    first.dispose();
    const change = vi.fn();
    const refreshed = createAppNavigation(browser, change);
    expect(history.state).toMatchObject({ unrelated: 'preserved',
      menuReaderNavigation: { depth: 0, route: { screen: 'menu' } } });
    expect(history.state).not.toMatchObject({ menuReaderNavigation: { session: previousSession } });
    expect(browser.location.href).toBe(originalUrl);
    refreshed.back();
    expect(change).not.toHaveBeenCalled();
    if (screen === 'search') history.forward();
    else history.back();
    expect(change).toHaveBeenLastCalledWith({ screen: 'menu' });
    history.back();
    expect(change).toHaveBeenLastCalledWith({ screen: 'menu' });
    history.forward();
    expect(change).toHaveBeenLastCalledWith({ screen: 'menu' });
    expect(browser.location.href).toBe(originalUrl);
    refreshed.dispose();
  });

  it.each(['rename', 'delete'] as const)('dismisses a %s dialog before leaving Recent Menus', (kind) => {
    const { browser, history } = createBrowser();
    const change = vi.fn();
    const navigation = createAppNavigation(browser, change);
    navigation.navigate({ screen: 'selection' });
    navigation.navigate({ screen: 'selection', action: { id: 'sample', kind } });
    navigation.back();
    expect(change).toHaveBeenLastCalledWith({ screen: 'selection' });
    history.back();
    expect(change).toHaveBeenLastCalledWith({ screen: 'menu' });
  });

  it('closes image inspection before leaving the photo preview', () => {
    const { browser } = createBrowser();
    const change = vi.fn();
    const navigation = createAppNavigation(browser, change);
    navigation.navigate({ screen: 'capture' });
    navigation.navigate({ screen: 'capture', imageId: 'photo-1' });
    navigation.back();
    expect(change).toHaveBeenLastCalledWith({ screen: 'capture' });
    navigation.back();
    expect(change).toHaveBeenLastCalledWith({ screen: 'menu' });
  });

  it('returns all the way home after deleting the selected menu without pushing another home entry', () => {
    const { browser, history } = createBrowser();
    const change = vi.fn();
    const navigation = createAppNavigation(browser, change);
    navigation.navigate({ screen: 'selection' });
    navigation.navigate({ screen: 'selection', action: { id: 'sample', kind: 'delete' } });
    navigation.home();
    expect(change).toHaveBeenLastCalledWith({ screen: 'menu' });
    expect(history.length).toBe(3);
    // Opening another screen drops the obsolete forward branch.
    navigation.navigate({ screen: 'capture' });
    expect(history.length).toBe(2);
    navigation.home();
    expect(change).toHaveBeenLastCalledWith({ screen: 'menu' });
  });

  it('starts home on refresh and ignores forward entries from before the refresh', () => {
    const { browser, history } = createBrowser();
    const first = createAppNavigation(browser, vi.fn());
    first.navigate({ screen: 'selection' });
    first.navigate({ screen: 'selection', action: { id: 'sample', kind: 'rename' } });
    first.back();
    first.dispose();
    const change = vi.fn();
    const refreshed = createAppNavigation(browser, change);
    expect(history.state).toMatchObject({ menuReaderNavigation: { route: { screen: 'menu' } } });
    history.forward();
    expect(change).toHaveBeenLastCalledWith({ screen: 'menu' });
    refreshed.dispose();
  });

  it('preserves unrelated state and removes its listener on cleanup', () => {
    const { browser, history } = createBrowser();
    const change = vi.fn();
    const navigation = createAppNavigation(browser, change);
    expect(history.state).toMatchObject({ unrelated: 'preserved' });
    navigation.navigate({ screen: 'quick-nav' });
    expect(history.state).toMatchObject({ unrelated: 'preserved' });
    navigation.dispose();
    change.mockClear();
    history.back();
    expect(change).not.toHaveBeenCalled();
  });
});