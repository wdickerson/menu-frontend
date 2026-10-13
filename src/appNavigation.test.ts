import { describe, expect, it, vi } from 'vitest';
import { createAppNavigation, type AppRoute } from './appNavigation';

function createBrowser() {
  const events = new EventTarget();
  const entries: unknown[] = [{ unrelated: 'preserved' }];
  let index = 0;
  const history = {
    get state() { return entries[index]; },
    get length() { return entries.length; },
    replaceState(state: unknown) { entries[index] = structuredClone(state); },
    pushState(state: unknown) {
      entries.splice(index + 1);
      entries.push(structuredClone(state));
      index += 1;
    },
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
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  } as unknown as Window;
  return { browser, history };
}

describe('app browser navigation', () => {
  it.each(['quick-nav', 'selection', 'capture'] as const)('returns from %s to home with Back and restores it with Forward', (screen) => {
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