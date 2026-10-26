import type { RestaurantMenu } from './data/menus';
import { postSharedMenu } from './menuSharingApi';
import { isSharedMenuId } from './sharedMenuId';

export type MenuShareState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'sharing'; url: string }
  | { status: 'copied' }
  | { status: 'error'; message: string };

async function copyShareLink(url: string) {
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
  await navigator.clipboard.writeText(url);
}

export function createMenuShareSession(onChange: (state: MenuShareState) => void,
  requests: {
    post: typeof postSharedMenu;
    share: (data: ShareData) => Promise<void> | null;
    copy?: (url: string) => Promise<void>;
  } = {
    post: postSharedMenu,
    share: (data: ShareData): Promise<void> | null =>
      typeof navigator.share === 'function' ? navigator.share(data) : null,
  }) {
  type Request = { controller: AbortController; timer: ReturnType<typeof setTimeout> | null };
  let active: Request | null = null;

  function cancel() {
    const current = active;
    active = null;
    if (current) {
      if (current.timer !== null) clearTimeout(current.timer);
      current.controller.abort();
    }
  }

  function start(menu: RestaurantMenu, saveId: (id: string) => boolean) {
    if (active) return false;
    const current: Request = { controller: new AbortController(), timer: null };
    active = current;
    void (async () => {
      let id = menu.sharedMenuId;
      try {
        if (!isSharedMenuId(id)) {
          onChange({ status: 'uploading' });
          current.timer = setTimeout(() => {
            if (active !== current) return;
            cancel();
            onChange({ status: 'error', message: 'Creating the share link took too long. Please try again.' });
          }, 15_000);
          id = await requests.post(menu, current.controller.signal);
          if (active !== current) return;
          if (current.timer !== null) clearTimeout(current.timer);
          current.timer = null;
          // Save against the originating local entry before opening native UI.
          // A rename/delete/navigation may have invalidated this snapshot.
          if (!saveId(id)) { cancel(); onChange({ status: 'idle' }); return; }
        }
      } catch (error) {
        if (active !== current) return;
        cancel();
        onChange({ status: 'error', message: error instanceof Error ? error.message
          : 'This menu could not be shared. Please try again.' });
        return;
      }
      if (active !== current) return;
      const url = `https://menu.littleapp.io/${id}`;
      onChange({ status: 'sharing', url });
      let copying = false;
      try {
        // For an already-shared menu this runs synchronously inside the click,
        // preserving transient activation. First-time POSTs may require a new tap.
        const shared = requests.share({ title: menu.restaurantName, url });
        if (shared === null) {
          copying = true;
          await (requests.copy ?? copyShareLink)(url);
          if (active !== current) return;
          active = null;
          onChange({ status: 'copied' });
          return;
        }
        await shared;
        if (active !== current) return;
        active = null;
        onChange({ status: 'idle' });
      } catch (error) {
        if (active !== current) return;
        active = null;
        if (!copying && error instanceof Error && error.name === 'AbortError') {
          onChange({ status: 'idle' });
        } else {
          onChange({ status: 'error', message: copying
            ? 'Could not copy the share link. Allow clipboard access and tap Share This Menu again.'
            : 'Could not open sharing. Tap Share This Menu again.' });
        }
      }
    })();
    return true;
  }

  return { start, cancel };
}