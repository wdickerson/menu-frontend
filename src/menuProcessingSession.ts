import type { RestaurantMenu } from './data/menus';
import type { ImagePreparationQueue } from './imagePreparationQueue';
import { postMenuImages } from './menuApi';
import { postOnlineMenu } from './menuOnlineTranscription';
import { getSharedMenu } from './menuSharingApi';
import type { PossibleMenu } from './menuSearchApi';

export type MenuProcessingJob =
  | { kind: 'images'; queue: ImagePreparationQueue }
  | { kind: 'online'; query: string; menu: PossibleMenu }
  | { kind: 'shared'; menuId: string };
export type MenuProcessingState =
  | { status: 'idle' }
  | { status: 'loading'; kind: MenuProcessingJob['kind'] }
  | { status: 'error'; kind: MenuProcessingJob['kind']; message: string };

// All menu sources share ownership, cancellation, retries, and the network deadline.
// Image preparation remains outside that deadline. Only successful owned work
// can replace the current menu; retained input is never written to storage.
export function createMenuProcessingSession(onChange: (state: MenuProcessingState) => void,
  onMenu: (menu: RestaurantMenu) => void,
  requests: { images: typeof postMenuImages; online: typeof postOnlineMenu; shared?: typeof getSharedMenu }
    = { images: postMenuImages, online: postOnlineMenu, shared: getSharedMenu }) {
  type Request = { controller: AbortController; timer: ReturnType<typeof setTimeout> | null };
  let active: Request | null = null;
  let pending: MenuProcessingJob | null = null;

  function discardPending() {
    if (pending?.kind === 'images') pending.queue.dispose();
    pending = null;
  }

  function cancel(notify = true) {
    const current = active;
    active = null;
    if (current) {
      if (current.timer !== null) clearTimeout(current.timer);
      current.controller.abort();
    }
    discardPending();
    if (notify) onChange({ status: 'idle' });
  }

  function start(input: MenuProcessingJob) {
    if (active) return false;
    if (pending !== input) discardPending();
    const job: MenuProcessingJob = input.kind === 'online' ? {
      kind: 'online', query: input.query, menu: { ...input.menu },
    } : input.kind === 'shared' ? { ...input } : input;
    pending = job;
    const current: Request = { controller: new AbortController(), timer: null };
    active = current;
    onChange({ status: 'loading', kind: job.kind });
    void (async () => {
      try {
        const images = job.kind === 'images' ? await job.queue.collect(current.controller.signal) : null;
        if (active !== current) return;
        current.timer = setTimeout(() => {
          if (active !== current) return;
          active = null;
          onChange({ status: 'error', kind: job.kind,
            message: 'Reading the menu took too long. Please retry or choose another menu.' });
          current.controller.abort();
        }, 35_000);
        const menu = job.kind === 'shared'
          ? await (requests.shared ?? getSharedMenu)(job.menuId, current.controller.signal)
          : job.kind === 'online'
          ? await requests.online(job.query, job.menu, current.controller.signal)
          : await requests.images(images!, current.controller.signal);
        if (active !== current) return;
        discardPending();
        active = null;
        onMenu(menu);
        onChange({ status: 'idle' });
      } catch (error) {
        if (active === current) {
          active = null;
          onChange({ status: 'error', kind: job.kind,
            message: error instanceof TypeError ? 'Could not reach the menu service. Check your connection and try again.'
              : error instanceof Error ? error.message : 'The menu could not be loaded. Try again.' });
        }
      } finally {
        if (current.timer !== null) clearTimeout(current.timer);
      }
    })();
    return true;
  }

  return { start, retry: () => pending ? start(pending) : false, cancel, dispose: () => cancel(false) };
}