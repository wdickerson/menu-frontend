import { searchMenusOnline, type PossibleMenu } from './menuSearchApi';

export type MenuSearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'complete'; query: string; menus: PossibleMenu[] }
  | { status: 'error'; query: string; message: string };

const SEARCH_TIMEOUT_MS = 35_000;

// Requests start on explicit submission, never a mounting effect (including
// Strict Mode and history Forward). Navigation and unmount revoke ownership
// before aborting, so even a transport that ignores abort cannot overwrite UI.
export function createMenuSearchSession(onChange: (state: MenuSearchState) => void,
  request = searchMenusOnline) {
  type Request = { controller: AbortController; timer: ReturnType<typeof setTimeout>; query: string };
  let active: Request | null = null;

  function cancel(notify = true) {
    const current = active;
    if (!current) return;
    active = null;
    clearTimeout(current.timer);
    current.controller.abort();
    if (notify) onChange({ status: 'error', query: current.query,
      message: 'Search canceled. Go back to search again.' });
  }

  return {
    cancel,
    start(query: string) {
      if (active) return false;
      const controller = new AbortController();
      const current: Request = { controller, query, timer: setTimeout(() => {
        if (active !== current) return;
        active = null;
        controller.abort();
        onChange({ status: 'error', query, message: 'Searching took too long. Go back and try again.' });
      }, SEARCH_TIMEOUT_MS) };
      active = current;
      onChange({ status: 'loading', query });
      void (async () => {
        try {
          const menus = await request(query, controller.signal);
          if (active === current) onChange({ status: 'complete', query, menus });
        } catch (error) {
          if (active === current) onChange({ status: 'error', query,
            message: error instanceof TypeError ? 'Could not reach the menu search service. Check your connection and try again.'
              : error instanceof Error ? error.message : 'Menus could not be searched. Please try again.' });
        } finally {
          clearTimeout(current.timer);
          if (active === current) active = null;
        }
      })();
      return true;
    },
  };
}