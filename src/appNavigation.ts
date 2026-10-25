export type AppRoute =
  | { screen: 'menu' }
  | { screen: 'quick-nav' }
  | { screen: 'search' }
  | { screen: 'capture'; imageId?: string }
  | { screen: 'selection'; action?: { id: string; kind: 'rename' | 'delete' } };

type NavigationEntry = { session: string; depth: number; route: AppRoute };
type NavigationWindow = Pick<Window, 'history' | 'addEventListener' | 'removeEventListener'>;

// Keep URLs unchanged, and deliberately start at home after every page load.
export function createAppNavigation(browser: NavigationWindow, onChange: (route: AppRoute) => void) {
  const session = crypto.randomUUID();
  let entry: NavigationEntry = { session, depth: 0, route: { screen: 'menu' } };
  const stateFor = (value: NavigationEntry) => ({ ...browser.history.state, menuReaderNavigation: value });
  browser.history.replaceState(stateFor(entry), '');

  function onPopState() {
    const saved = browser.history.state?.menuReaderNavigation as NavigationEntry | undefined;
    if (saved?.session === session) {
      entry = saved;
    } else {
      // Entries left over from a previous page load must not resurrect old dialogs.
      entry = { session, depth: 0, route: { screen: 'menu' } };
      browser.history.replaceState(stateFor(entry), '');
    }
    onChange(entry.route);
  }
  browser.addEventListener('popstate', onPopState);

  return {
    navigate(route: AppRoute) {
      entry = { session, depth: entry.depth + 1, route };
      browser.history.pushState(stateFor(entry), '');
      onChange(route);
    },
    back() {
      if (entry.depth > 0) browser.history.back();
    },
    home() {
      if (entry.depth > 0) browser.history.go(-entry.depth);
    },
    dispose() {
      browser.removeEventListener('popstate', onPopState);
    },
  };
}