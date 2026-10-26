import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RestaurantMenu } from './data/menus';
import { createMenuShareSession, type MenuShareState } from './menuShareSession';
import { postSharedMenu } from './menuSharingApi';

const menu: RestaurantMenu = { restaurantName: 'Cafe', sections: [{ name: 'Dinner', items: ['Soup $8'] }] };
const sharedMenuId = 'AbCdEf0123_-xy';
const otherId = 'ZyXwVu9876_-ab';
const url = `https://menu.littleapp.io/${sharedMenuId}`;
const sharedMenu = { ...menu, sharedMenuId };
const timeoutMessage = 'Creating the share link took too long. Please try again.';
const nativeErrorMessage = 'Could not open sharing. Tap Share This Menu again.';
const copyErrorMessage = 'Could not copy the share link. Allow clipboard access and tap Share This Menu again.';
type Requests = NonNullable<Parameters<typeof createMenuShareSession>[1]>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const upload = deferred<string>();
  const sharing = deferred<void>();
  const copying = deferred<void>();
  const post = vi.fn<Requests['post']>().mockReturnValue(upload.promise);
  const share = vi.fn<Requests['share']>().mockReturnValue(sharing.promise);
  const copy = vi.fn<NonNullable<Requests['copy']>>().mockReturnValue(copying.promise);
  const onChange = vi.fn<(state: MenuShareState) => void>();
  const saveId = vi.fn<(id: string) => boolean>().mockReturnValue(true);
  const session = createMenuShareSession(onChange, { post, share, copy });
  return { session, upload, sharing, copying, post, share, copy, onChange, saveId };
}

async function flush() { for (let index = 0; index < 6; index++) await Promise.resolve(); }

async function settleUpload(pending: ReturnType<typeof deferred<string>>, outcome: 'response' | 'rejection') {
  if (outcome === 'response') pending.resolve(sharedMenuId);
  else pending.reject(new Error('Late transport failure'));
  await flush();
}

async function settleCopy(pending: ReturnType<typeof deferred<void>>, outcome: 'response' | 'rejection') {
  if (outcome === 'response') pending.resolve(undefined);
  else pending.reject(new Error('PRIVATE late clipboard failure'));
  await flush();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('explicit menu sharing', () => {
  it('does not POST, share, save, notify, or schedule work before an explicit start', async () => {
    const test = harness();
    test.session.cancel();
    test.session.cancel();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(test.post).not.toHaveBeenCalled();
    expect(test.share).not.toHaveBeenCalled();
    expect(test.copy).not.toHaveBeenCalled();
    expect(test.saveId).not.toHaveBeenCalled();
    expect(test.onChange).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('POSTs once on explicit start, saves the returned ID, then opens native sharing in that order', async () => {
    const test = harness();
    const order: string[] = [];
    test.post.mockImplementation(() => { order.push('post'); return test.upload.promise; });
    test.saveId.mockImplementation((id) => { expect(id).toBe(sharedMenuId); order.push('save'); return true; });
    test.share.mockImplementation(() => { order.push('share'); return test.sharing.promise; });
    const original = structuredClone(menu);

    expect(test.session.start(menu, test.saveId)).toBe(true);
    expect(test.post).toHaveBeenCalledExactlyOnceWith(menu, expect.any(AbortSignal));
    expect(test.post.mock.calls[0][1].aborted).toBe(false);
    expect(test.onChange).toHaveBeenCalledExactlyOnceWith({ status: 'uploading' });
    expect(test.saveId).not.toHaveBeenCalled();
    expect(test.share).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    test.upload.resolve(sharedMenuId);
    await flush();
    expect(order).toEqual(['post', 'save', 'share']);
    expect(test.share).toHaveBeenCalledExactlyOnceWith({ title: menu.restaurantName, url });
    expect(test.onChange.mock.calls).toEqual([[{ status: 'uploading' }], [{ status: 'sharing', url }]]);
    expect(vi.getTimerCount()).toBe(0);
    expect(menu).toEqual(original);

    test.sharing.resolve(undefined);
    await flush();
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'idle' });
    expect(test.copy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(test.post).toHaveBeenCalledOnce();
    expect(test.share).toHaveBeenCalledOnce();
  });

  it('calls native share synchronously for an existing valid ID without POSTing, saving, or starting a timer', async () => {
    const test = harness();
    let insideStart = true;
    test.share.mockImplementation(() => {
      expect(insideStart).toBe(true);
      return test.sharing.promise;
    });
    expect(test.session.start(sharedMenu, test.saveId)).toBe(true);
    insideStart = false;
    expect(test.share).toHaveBeenCalledExactlyOnceWith({ title: menu.restaurantName, url });
    expect(test.post).not.toHaveBeenCalled();
    expect(test.saveId).not.toHaveBeenCalled();
    expect(test.onChange).toHaveBeenCalledExactlyOnceWith({ status: 'sharing', url });
    expect(vi.getTimerCount()).toBe(0);
    test.sharing.resolve(undefined);
    await flush();
    expect(test.saveId).not.toHaveBeenCalled();
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'idle' });
    expect(test.copy).not.toHaveBeenCalled();
  });

  it.each(['', 'short', 'a'.repeat(15), 'abcdefghijklm/', `${sharedMenuId}\n`])
    ('POSTs rather than reusing an invalid existing ID %j', (id) => {
      const test = harness();
      test.session.start({ ...menu, sharedMenuId: id }, test.saveId);
      expect(test.post).toHaveBeenCalledOnce();
      expect(test.share).not.toHaveBeenCalled();
      test.session.cancel();
    });

  it('uses the fixed HTTPS public origin rather than the current browser origin or deployment path', () => {
    vi.stubGlobal('location', new URL('http://localhost:5173/menu/?private=query#hash'));
    const test = harness();
    test.share.mockReturnValue(null);
    test.session.start(sharedMenu, test.saveId);
    expect(test.share).toHaveBeenCalledExactlyOnceWith({ title: menu.restaurantName, url });
    expect(new URL(url).origin).toBe('https://menu.littleapp.io');
  });

  it('suppresses duplicate starts throughout both the POST and native share phases', async () => {
    const test = harness();
    const ignoredSave = vi.fn(() => true);
    test.session.start(menu, test.saveId);
    expect(test.session.start(menu, ignoredSave)).toBe(false);
    expect(test.session.start({ ...sharedMenu, restaurantName: 'Different menu' }, ignoredSave)).toBe(false);
    test.upload.resolve(sharedMenuId);
    await flush();
    expect(test.session.start(menu, ignoredSave)).toBe(false);
    expect(test.session.start(sharedMenu, ignoredSave)).toBe(false);
    expect(test.post).toHaveBeenCalledOnce();
    expect(test.share).toHaveBeenCalledOnce();
    expect(ignoredSave).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'sharing', url });
    test.sharing.resolve(undefined);
    await flush();
    expect(test.session.start(sharedMenu, ignoredSave)).toBe(true);
    expect(test.share).toHaveBeenCalledTimes(2);
    expect(test.post).toHaveBeenCalledOnce();
    expect(ignoredSave).not.toHaveBeenCalled();
    await flush();
  });

  it('keeps the uploaded ID in the callback snapshot after native abort and re-shares without another POST', async () => {
    const test = harness();
    let snapshot: RestaurantMenu = menu;
    const saveSnapshot = vi.fn((id: string) => { snapshot = { ...snapshot, sharedMenuId: id }; return true; });
    test.session.start(snapshot, saveSnapshot);
    test.upload.resolve(sharedMenuId);
    await flush();
    expect(snapshot).toEqual(sharedMenu);
    test.sharing.reject(new DOMException('User dismissed the sheet', 'AbortError'));
    await flush();
    expect(test.onChange.mock.calls).toEqual([
      [{ status: 'uploading' }], [{ status: 'sharing', url }], [{ status: 'idle' }],
    ]);
    expect(test.copy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(test.share).toHaveBeenCalledOnce();

    test.share.mockResolvedValueOnce(undefined);
    const resave = vi.fn(() => true);
    expect(test.session.start(snapshot, resave)).toBe(true);
    expect(test.share).toHaveBeenCalledTimes(2);
    expect(test.share).toHaveBeenLastCalledWith({ title: menu.restaurantName, url });
    expect(test.post).toHaveBeenCalledOnce();
    expect(saveSnapshot).toHaveBeenCalledExactlyOnceWith(sharedMenuId);
    expect(resave).not.toHaveBeenCalled();
    await flush();
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'idle' });
    expect(test.copy).not.toHaveBeenCalled();
  });

  it('silently handles a synchronous native AbortError without copying or losing the existing ID', async () => {
    const test = harness();
    test.share.mockImplementationOnce(() => { throw new DOMException('PRIVATE dismissal details', 'AbortError'); });
    expect(test.session.start(sharedMenu, test.saveId)).toBe(true);
    expect(test.onChange.mock.calls).toEqual([[{ status: 'sharing', url }], [{ status: 'idle' }]]);
    expect(test.copy).not.toHaveBeenCalled();
    expect(sharedMenu.sharedMenuId).toBe(sharedMenuId);
    test.share.mockResolvedValueOnce(undefined);
    expect(test.session.start(sharedMenu, test.saveId)).toBe(true);
    await flush();
    expect(test.share).toHaveBeenCalledTimes(2);
    expect(test.post).not.toHaveBeenCalled();
    expect(test.saveId).not.toHaveBeenCalled();
    expect(test.copy).not.toHaveBeenCalled();
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'idle' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['throw', 'reject'] as const)('handles native activation %s with safe guidance and permits explicit reuse', async (outcome) => {
    const test = harness();
    const error = new DOMException('PRIVATE browser activation details', 'NotAllowedError');
    if (outcome === 'throw') test.share.mockImplementationOnce(() => { throw error; });
    test.session.start(menu, test.saveId);
    test.upload.resolve(sharedMenuId);
    await flush();
    if (outcome === 'reject') { test.sharing.reject(error); await flush(); }
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'error', message: nativeErrorMessage });
    expect(JSON.stringify(test.onChange.mock.calls)).not.toContain('PRIVATE');
    expect(test.copy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(test.share).toHaveBeenCalledOnce();
    expect(test.post).toHaveBeenCalledOnce();

    test.share.mockResolvedValueOnce(undefined);
    expect(test.session.start({ ...menu, sharedMenuId: test.saveId.mock.calls[0][0] }, test.saveId)).toBe(true);
    expect(test.share).toHaveBeenCalledTimes(2);
    expect(test.post).toHaveBeenCalledOnce();
    expect(test.saveId).toHaveBeenCalledOnce();
    await flush();
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'idle' });
    expect(test.copy).not.toHaveBeenCalled();
  });
});

describe('automatic clipboard sharing', () => {
  it.each([false, true])('copies new and existing links only after saving and awaits clipboard success (existing: %s)', async (existing) => {
    const test = harness();
    const order: string[] = [];
    let snapshot: RestaurantMenu = existing ? sharedMenu : menu;
    test.post.mockImplementation(() => { order.push('post'); return test.upload.promise; });
    test.saveId.mockImplementation((id) => {
      snapshot = { ...snapshot, sharedMenuId: id };
      order.push('save');
      return true;
    });
    test.share.mockImplementation(() => { order.push('share'); return null; });
    test.copy.mockImplementation((link) => {
      expect(snapshot.sharedMenuId).toBe(sharedMenuId);
      expect(link).toBe(url);
      order.push('copy');
      return test.copying.promise;
    });

    expect(test.session.start(snapshot, test.saveId)).toBe(true);
    if (!existing) {
      expect(test.copy).not.toHaveBeenCalled();
      test.upload.resolve(sharedMenuId);
    }
    await flush();
    expect(order).toEqual(existing ? ['share', 'copy'] : ['post', 'save', 'share', 'copy']);
    expect(test.copy).toHaveBeenCalledExactlyOnceWith(url);
    expect(test.share).toHaveBeenCalledExactlyOnceWith({ title: menu.restaurantName, url });
    expect(test.saveId).toHaveBeenCalledTimes(existing ? 0 : 1);
    expect(test.post).toHaveBeenCalledTimes(existing ? 0 : 1);
    expect(snapshot).toEqual(sharedMenu);
    const pendingStates = existing
      ? [[{ status: 'sharing', url }]]
      : [[{ status: 'uploading' }], [{ status: 'sharing', url }]];
    expect(test.onChange.mock.calls).toEqual(pendingStates);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(test.onChange.mock.calls).toEqual(pendingStates);

    test.copying.resolve(undefined);
    await flush();
    expect(test.onChange.mock.calls).toEqual([...pendingStates, [{ status: 'copied' }]]);
    expect(test.post).toHaveBeenCalledTimes(existing ? 0 : 1);
    expect(test.copy).toHaveBeenCalledOnce();
  });

  it('invokes copy synchronously within start for a known ID to preserve transient activation', async () => {
    const test = harness();
    test.share.mockReturnValue(null);
    let insideStart = true;
    test.copy.mockImplementation(() => {
      expect(insideStart).toBe(true);
      return test.copying.promise;
    });
    expect(test.session.start(sharedMenu, test.saveId)).toBe(true);
    insideStart = false;
    expect(test.copy).toHaveBeenCalledExactlyOnceWith(url);
    expect(test.post).not.toHaveBeenCalled();
    expect(test.saveId).not.toHaveBeenCalled();
    expect(test.onChange).toHaveBeenCalledExactlyOnceWith({ status: 'sharing', url });
    test.copying.resolve(undefined);
    await flush();
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'copied' });
  });

  it('uses navigator.clipboard.writeText automatically when the default native share API is missing', async () => {
    const copying = deferred<void>();
    const writeText = vi.fn<(text: string) => Promise<void>>().mockReturnValue(copying.promise);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onChange = vi.fn<(state: MenuShareState) => void>();
    const saveId = vi.fn(() => true);
    const session = createMenuShareSession(onChange);

    expect(session.start(sharedMenu, saveId)).toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(url);
    await flush();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ status: 'sharing', url });
    copying.resolve(undefined);
    await flush();
    expect(onChange.mock.calls).toEqual([[{ status: 'sharing', url }], [{ status: 'copied' }]]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saveId).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['success', 'cancel', 'reject', 'throw'] as const)
    ('does not fall back to the clipboard when the default native share API exists (%s)', async (outcome) => {
      const nativeShare = vi.fn<(data: ShareData) => Promise<void>>();
      const error = new DOMException('PRIVATE native details', outcome === 'cancel' ? 'AbortError' : 'NotAllowedError');
      if (outcome === 'success') nativeShare.mockResolvedValue(undefined);
      else if (outcome === 'throw') nativeShare.mockImplementation(() => { throw error; });
      else nativeShare.mockRejectedValue(error);
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { share: nativeShare, clipboard: { writeText } });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const onChange = vi.fn<(state: MenuShareState) => void>();
      const saveId = vi.fn(() => true);
      const session = createMenuShareSession(onChange);

      expect(session.start(sharedMenu, saveId)).toBe(true);
      await flush();
      expect(nativeShare).toHaveBeenCalledExactlyOnceWith({ title: menu.restaurantName, url });
      expect(onChange.mock.calls).toEqual([
        [{ status: 'sharing', url }],
        [outcome === 'success' || outcome === 'cancel'
          ? { status: 'idle' } : { status: 'error', message: nativeErrorMessage }],
      ]);
      expect(writeText).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(saveId).not.toHaveBeenCalled();
      expect(JSON.stringify(onChange.mock.calls)).not.toContain('PRIVATE');
    });

  it.each(['missing clipboard', 'missing writeText', 'reject', 'throw'] as const)
    ('reports a safe default clipboard error for %s and retains the saved ID for a no-POST retry', async (outcome) => {
      const test = harness();
      test.share.mockReturnValue(null);
      const writeText = vi.fn<(text: string) => Promise<void>>();
      const error = new DOMException('PRIVATE clipboard permissions', 'NotAllowedError');
      if (outcome === 'throw') writeText.mockImplementation(() => { throw error; });
      else writeText.mockRejectedValue(error);
      vi.stubGlobal('navigator', outcome === 'missing clipboard' ? {}
        : { clipboard: outcome === 'missing writeText' ? {} : { writeText } });
      const session = createMenuShareSession(test.onChange, { post: test.post, share: test.share });
      let snapshot: RestaurantMenu = menu;
      test.saveId.mockImplementation((id) => { snapshot = { ...snapshot, sharedMenuId: id }; return true; });

      expect(session.start(snapshot, test.saveId)).toBe(true);
      test.upload.resolve(sharedMenuId);
      await flush();
      expect(test.onChange.mock.calls).toEqual([
        [{ status: 'uploading' }], [{ status: 'sharing', url }], [{ status: 'error', message: copyErrorMessage }],
      ]);
      expect(snapshot).toEqual(sharedMenu);
      expect(test.saveId).toHaveBeenCalledExactlyOnceWith(sharedMenuId);
      expect(writeText).toHaveBeenCalledTimes(outcome.startsWith('missing') ? 0 : 1);
      if (!outcome.startsWith('missing')) expect(writeText).toHaveBeenCalledWith(url);
      expect(JSON.stringify(test.onChange.mock.calls)).not.toContain('PRIVATE');
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(test.post).toHaveBeenCalledOnce();
      expect(test.share).toHaveBeenCalledOnce();

      const retryCopy = deferred<void>();
      const retryWriteText = vi.fn<(text: string) => Promise<void>>().mockReturnValue(retryCopy.promise);
      vi.stubGlobal('navigator', { clipboard: { writeText: retryWriteText } });
      expect(session.start(snapshot, test.saveId)).toBe(true);
      expect(retryWriteText).toHaveBeenCalledExactlyOnceWith(url);
      expect(test.onChange).toHaveBeenLastCalledWith({ status: 'sharing', url });
      retryCopy.resolve(undefined);
      await flush();
      expect(test.onChange).toHaveBeenLastCalledWith({ status: 'copied' });
      expect(test.post).toHaveBeenCalledOnce();
      expect(test.share).toHaveBeenCalledTimes(2);
      expect(test.saveId).toHaveBeenCalledOnce();
      expect(test.copy).not.toHaveBeenCalled();
    });

  it.each([
    { outcome: 'throw', error: new Error('PRIVATE injected copy failure') },
    { outcome: 'reject', error: 'PRIVATE non-Error clipboard failure' },
    { outcome: 'AbortError rejection', error: new DOMException('PRIVATE copy cancellation', 'AbortError') },
  ])('never reports copied or a silent native cancellation for an injected copy $outcome', async ({ outcome, error }) => {
    const test = harness();
    test.share.mockReturnValue(null);
    if (outcome === 'throw') test.copy.mockImplementationOnce(() => { throw error; });
    else test.copy.mockRejectedValueOnce(error);
    expect(test.session.start(sharedMenu, test.saveId)).toBe(true);
    await flush();
    expect(test.onChange.mock.calls).toEqual([
      [{ status: 'sharing', url }], [{ status: 'error', message: copyErrorMessage }],
    ]);
    expect(JSON.stringify(test.onChange.mock.calls)).not.toContain('PRIVATE');
    test.copy.mockResolvedValueOnce(undefined);
    expect(test.session.start(sharedMenu, test.saveId)).toBe(true);
    await flush();
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'copied' });
    expect(test.copy).toHaveBeenCalledTimes(2);
    expect(test.copy).toHaveBeenNthCalledWith(2, url);
    expect(test.post).not.toHaveBeenCalled();
    expect(test.saveId).not.toHaveBeenCalled();
  });

  it.each([false, true])('suppresses duplicate starts while clipboard access is pending (existing: %s)', async (existing) => {
    const test = harness();
    test.share.mockReturnValue(null);
    expect(test.session.start(existing ? sharedMenu : menu, test.saveId)).toBe(true);
    if (!existing) test.upload.resolve(sharedMenuId);
    await flush();
    const ignoredSave = vi.fn(() => true);
    expect(test.session.start(menu, ignoredSave)).toBe(false);
    expect(test.session.start({ ...menu, sharedMenuId: otherId }, ignoredSave)).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(test.session.start(sharedMenu, ignoredSave)).toBe(false);
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'sharing', url });
    expect(test.copy).toHaveBeenCalledExactlyOnceWith(url);
    expect(test.share).toHaveBeenCalledOnce();
    expect(test.post).toHaveBeenCalledTimes(existing ? 0 : 1);
    expect(ignoredSave).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    test.copying.resolve(undefined);
    await flush();
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'copied' });
    expect(test.session.start(sharedMenu, ignoredSave)).toBe(true);
    await flush();
    expect(test.copy).toHaveBeenCalledTimes(2);
    expect(test.share).toHaveBeenCalledTimes(2);
    expect(test.post).toHaveBeenCalledTimes(existing ? 0 : 1);
    expect(ignoredSave).not.toHaveBeenCalled();
  });

  it.each(['response', 'rejection'] as const)('ignores a late clipboard %s after cancellation and reuses the retained ID', async (outcome) => {
    const test = harness();
    test.share.mockReturnValue(null);
    let snapshot: RestaurantMenu = menu;
    test.saveId.mockImplementation((id) => { snapshot = { ...snapshot, sharedMenuId: id }; return true; });
    test.session.start(snapshot, test.saveId);
    test.upload.resolve(sharedMenuId);
    await flush();
    expect(test.copy).toHaveBeenCalledExactlyOnceWith(url);
    test.session.cancel();
    test.session.cancel();
    const notifications = test.onChange.mock.calls.slice();
    await settleCopy(test.copying, outcome);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(test.onChange.mock.calls).toEqual(notifications);
    expect(snapshot).toEqual(sharedMenu);
    expect(vi.getTimerCount()).toBe(0);

    test.copy.mockResolvedValueOnce(undefined);
    expect(test.session.start(snapshot, test.saveId)).toBe(true);
    await flush();
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'copied' });
    expect(test.copy).toHaveBeenCalledTimes(2);
    expect(test.post).toHaveBeenCalledOnce();
    expect(test.saveId).toHaveBeenCalledExactlyOnceWith(sharedMenuId);
  });

  it.each([
    { phase: 'active', outcome: 'response' }, { phase: 'active', outcome: 'rejection' },
    { phase: 'completed', outcome: 'response' }, { phase: 'completed', outcome: 'rejection' },
  ] as const)('ignores an old clipboard $outcome without overwriting or releasing a newer $phase copy', async ({ phase, outcome }) => {
    const test = harness();
    const newer = deferred<void>();
    const newerUrl = `https://menu.littleapp.io/${otherId}`;
    test.share.mockReturnValue(null);
    test.copy.mockReturnValueOnce(test.copying.promise).mockReturnValueOnce(newer.promise);
    expect(test.session.start(sharedMenu, test.saveId)).toBe(true);
    test.session.cancel();
    expect(test.session.start({ ...menu, sharedMenuId: otherId }, test.saveId)).toBe(true);
    expect(test.copy).toHaveBeenNthCalledWith(1, url);
    expect(test.copy).toHaveBeenNthCalledWith(2, newerUrl);
    if (phase === 'completed') {
      newer.resolve(undefined);
      await flush();
      expect(test.onChange).toHaveBeenLastCalledWith({ status: 'copied' });
    }
    const notifications = test.onChange.mock.calls.slice();
    await settleCopy(test.copying, outcome);
    expect(test.onChange.mock.calls).toEqual(notifications);
    if (phase === 'active') {
      expect(test.onChange).toHaveBeenLastCalledWith({ status: 'sharing', url: newerUrl });
      expect(test.session.start(sharedMenu, test.saveId)).toBe(false);
      newer.resolve(undefined);
      await flush();
      expect(test.onChange).toHaveBeenLastCalledWith({ status: 'copied' });
    }
    expect(test.copy).toHaveBeenCalledTimes(2);
    expect(test.share).toHaveBeenCalledTimes(2);
    expect(test.post).not.toHaveBeenCalled();
    expect(test.saveId).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('saving the originating menu snapshot', () => {
  it('does not publish a link or open native sharing when the save callback rejects a stale snapshot', async () => {
    const test = harness();
    test.saveId.mockReturnValue(false);
    test.session.start(menu, test.saveId);
    test.upload.resolve(sharedMenuId);
    await flush();
    expect(test.saveId).toHaveBeenCalledExactlyOnceWith(sharedMenuId);
    expect(test.share).not.toHaveBeenCalled();
    expect(test.copy).not.toHaveBeenCalled();
    expect(test.onChange.mock.calls).toEqual([[{ status: 'uploading' }], [{ status: 'idle' }]]);
    expect(test.post.mock.calls[0][1].aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(test.post).toHaveBeenCalledOnce();
    expect(test.session.start(sharedMenu, test.saveId)).toBe(true);
    expect(test.share).toHaveBeenCalledOnce();
    expect(test.saveId).toHaveBeenCalledOnce();
    test.session.cancel();
  });

  it('does not publish a link or share when saving throws, and releases the active request', async () => {
    const test = harness();
    test.saveId.mockImplementation(() => { throw new Error('The local menu is no longer available.'); });
    test.session.start(menu, test.saveId);
    test.upload.resolve(sharedMenuId);
    await flush();
    expect(test.share).not.toHaveBeenCalled();
    expect(test.copy).not.toHaveBeenCalled();
    expect(test.onChange.mock.calls).toEqual([[{ status: 'uploading' }], [{ status: 'error',
      message: 'The local menu is no longer available.' }]]);
    expect(vi.getTimerCount()).toBe(0);
    expect(test.session.start(sharedMenu, test.saveId)).toBe(true);
    expect(test.saveId).toHaveBeenCalledOnce();
    test.session.cancel();
  });
});

describe('sharing service errors', () => {
  it.each([
    { label: 'safe API error', error: new Error('The menu sharing service is busy. Please try again shortly.'),
      message: 'The menu sharing service is busy. Please try again shortly.' },
    { label: 'non-Error rejection', error: 'PRIVATE provider details', message: 'This menu could not be shared. Please try again.' },
    { label: 'null rejection', error: null, message: 'This menu could not be shared. Please try again.' },
  ])('reports $label without saving, sharing, or automatically retrying', async ({ error, message }) => {
    const test = harness();
    test.session.start(menu, test.saveId);
    test.upload.reject(error);
    await flush();
    expect(test.onChange.mock.calls).toEqual([[{ status: 'uploading' }], [{ status: 'error', message }]]);
    expect(test.share).not.toHaveBeenCalled();
    expect(test.saveId).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(test.post).toHaveBeenCalledOnce();
    const retry = deferred<string>();
    test.post.mockReturnValueOnce(retry.promise);
    expect(test.session.start(menu, test.saveId)).toBe(true);
    expect(test.post).toHaveBeenCalledTimes(2);
    test.session.cancel();
    retry.resolve(sharedMenuId);
    await flush();
    expect(test.share).not.toHaveBeenCalled();
  });

  it('handles a synchronous POST failure, clears its timer, and permits an explicit retry', () => {
    const test = harness();
    test.post.mockImplementation(() => { throw new Error('This menu is invalid. Load a menu before sharing it.'); });
    expect(test.session.start(menu, test.saveId)).toBe(true);
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'error',
      message: 'This menu is invalid. Load a menu before sharing it.' });
    expect(test.share).not.toHaveBeenCalled();
    expect(test.saveId).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(test.session.start(menu, test.saveId)).toBe(true);
    expect(test.post).toHaveBeenCalledTimes(2);
  });

  it.each([
    { status: 413, message: 'This menu is too large to share. Try sharing a smaller menu.' },
    { status: 429, message: 'The menu sharing service is busy. Please try again shortly.' },
    { status: 500, message: 'The menu could not be shared (HTTP 500). Please try again.' },
    { status: 503, message: 'The menu sharing service is currently unavailable. Please try again later.' },
    { status: 504, message: 'The menu sharing request took too long. Please try again.' },
  ])('publishes the real POST adapter\'s safe HTTP $status message without leaking the response or retrying', async ({ status, message }) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'PRIVATE service body' }), { status }));
    vi.stubGlobal('fetch', fetchMock);
    const onChange = vi.fn();
    const share = vi.fn<Requests['share']>().mockResolvedValue(undefined);
    const saveId = vi.fn(() => true);
    const post = vi.fn<Requests['post']>().mockImplementation(postSharedMenu);
    const session = createMenuShareSession(onChange, { post, share });
    session.start(menu, saveId);
    await expect(post.mock.results[0].value).rejects.toThrow(message);
    await flush();
    expect(onChange).toHaveBeenLastCalledWith({ status: 'error', message });
    expect(JSON.stringify(onChange.mock.calls)).not.toContain('PRIVATE');
    expect(share).not.toHaveBeenCalled();
    expect(saveId).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('publishes a safe network error from the POST adapter without leaking transport details or retrying', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('PRIVATE transport details'));
    vi.stubGlobal('fetch', fetchMock);
    const onChange = vi.fn();
    const share = vi.fn<Requests['share']>().mockReturnValue(null);
    const post = vi.fn<Requests['post']>().mockImplementation(postSharedMenu);
    const session = createMenuShareSession(onChange, { post, share });
    session.start(menu, vi.fn(() => true));
    await expect(post.mock.results[0].value).rejects.toThrow('Check your connection');
    await flush();
    expect(onChange).toHaveBeenLastCalledWith({ status: 'error',
      message: 'The menu sharing service could not be reached. Check your connection and try again.' });
    expect(JSON.stringify(onChange.mock.calls)).not.toContain('PRIVATE');
    expect(share).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('sharing timeout, cancellation, and request ownership', () => {
  it.each(['response', 'rejection'] as const)('aborts at exactly 15,000 ms and ignores a late %s without automatically retrying', async (outcome) => {
    const test = harness();
    test.session.start(menu, test.saveId);
    const signal = test.post.mock.calls[0][1];
    await vi.advanceTimersByTimeAsync(14_999);
    expect(signal.aborted).toBe(false);
    expect(test.onChange).toHaveBeenCalledExactlyOnceWith({ status: 'uploading' });
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    expect(test.onChange.mock.calls).toEqual([[{ status: 'uploading' }], [{ status: 'error', message: timeoutMessage }]]);
    expect(vi.getTimerCount()).toBe(0);
    await settleUpload(test.upload, outcome);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(test.onChange).toHaveBeenCalledTimes(2);
    expect(test.post).toHaveBeenCalledOnce();
    expect(test.saveId).not.toHaveBeenCalled();
    expect(test.share).not.toHaveBeenCalled();
  });

  it('keeps the timeout error when abort synchronously rejects the pending POST', async () => {
    const test = harness();
    test.post.mockImplementation((_menu, signal) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    test.session.start(menu, test.saveId);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(test.onChange.mock.calls).toEqual([[{ status: 'uploading' }], [{ status: 'error', message: timeoutMessage }]]);
    expect(test.share).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['response', 'rejection'] as const)('silently cancels once and ignores a late POST %s', async (outcome) => {
    const test = harness();
    test.session.start(menu, test.saveId);
    const signal = test.post.mock.calls[0][1];
    const aborted = vi.fn();
    signal.addEventListener('abort', aborted);
    test.session.cancel();
    test.session.cancel();
    expect(signal.aborted).toBe(true);
    expect(aborted).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await settleUpload(test.upload, outcome);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(test.onChange).toHaveBeenCalledExactlyOnceWith({ status: 'uploading' });
    expect(test.saveId).not.toHaveBeenCalled();
    expect(test.share).not.toHaveBeenCalled();
    expect(test.post).toHaveBeenCalledOnce();
  });

  it.each(['response', 'rejection'] as const)('ignores late native share %s after cancellation and preserves the saved ID', async (outcome) => {
    const test = harness();
    let snapshot: RestaurantMenu = menu;
    const save = vi.fn((id: string) => { snapshot = { ...snapshot, sharedMenuId: id }; return true; });
    test.session.start(snapshot, save);
    test.upload.resolve(sharedMenuId);
    await flush();
    test.session.cancel();
    const notifications = test.onChange.mock.calls.slice();
    if (outcome === 'response') test.sharing.resolve(undefined);
    else test.sharing.reject(new DOMException('Dismissed after cancellation', 'AbortError'));
    await flush();
    expect(test.onChange.mock.calls).toEqual(notifications);
    expect(snapshot).toEqual(sharedMenu);
    test.share.mockResolvedValueOnce(undefined);
    expect(test.session.start(snapshot, save)).toBe(true);
    expect(test.post).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    expect(test.share).toHaveBeenCalledTimes(2);
    await flush();
  });

  it.each([
    { stop: 'cancel', outcome: 'response' }, { stop: 'cancel', outcome: 'rejection' },
    { stop: 'timeout', outcome: 'response' }, { stop: 'timeout', outcome: 'rejection' },
  ] as const)('does not let an old $outcome after $stop overwrite or release an active retry', async ({ stop, outcome }) => {
    const test = harness();
    const newer = deferred<string>();
    const retrySave = vi.fn(() => true);
    test.post.mockReturnValueOnce(test.upload.promise).mockReturnValueOnce(newer.promise);
    test.session.start(menu, test.saveId);
    if (stop === 'timeout') await vi.advanceTimersByTimeAsync(15_000);
    else test.session.cancel();
    expect(test.session.start({ ...menu, restaurantName: 'Retry cafe' }, retrySave)).toBe(true);
    const retrySignal = test.post.mock.calls[1][1];
    const notifications = test.onChange.mock.calls.slice();
    await settleUpload(test.upload, outcome);
    expect(test.onChange.mock.calls).toEqual(notifications);
    expect(test.saveId).not.toHaveBeenCalled();
    expect(test.share).not.toHaveBeenCalled();
    expect(retrySignal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    expect(test.session.start(menu, test.saveId)).toBe(false);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(retrySignal.aborted).toBe(false);
    newer.resolve(otherId);
    await flush();
    expect(retrySave).toHaveBeenCalledExactlyOnceWith(otherId);
    expect(test.share).toHaveBeenCalledExactlyOnceWith({ title: 'Retry cafe', url: `https://menu.littleapp.io/${otherId}` });
    expect(vi.getTimerCount()).toBe(0);
    test.sharing.resolve(undefined);
    await flush();
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'idle' });
  });

  it.each(['response', 'rejection'] as const)('does not let an old POST %s overwrite a completed retry', async (outcome) => {
    const test = harness();
    const newer = deferred<string>();
    test.post.mockReturnValueOnce(test.upload.promise).mockReturnValueOnce(newer.promise);
    test.share.mockResolvedValue(undefined);
    test.session.start(menu, test.saveId);
    test.session.cancel();
    test.session.start(menu, test.saveId);
    newer.resolve(otherId);
    await flush();
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'idle' });
    const notifications = test.onChange.mock.calls.slice();
    await settleUpload(test.upload, outcome);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(test.onChange.mock.calls).toEqual(notifications);
    expect(test.saveId).toHaveBeenCalledExactlyOnceWith(otherId);
    expect(test.share).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['response', 'rejection'] as const)('does not let a canceled native share %s overwrite a newer active share', async (outcome) => {
    const test = harness();
    const newer = deferred<void>();
    test.share.mockReturnValueOnce(test.sharing.promise).mockReturnValueOnce(newer.promise);
    test.session.start(sharedMenu, test.saveId);
    test.session.cancel();
    test.session.start({ ...menu, sharedMenuId: otherId }, test.saveId);
    const notifications = test.onChange.mock.calls.slice();
    if (outcome === 'response') test.sharing.resolve(undefined);
    else test.sharing.reject(new Error('Old native share failure'));
    await flush();
    expect(test.onChange.mock.calls).toEqual(notifications);
    expect(test.session.start(sharedMenu, test.saveId)).toBe(false);
    newer.resolve(undefined);
    await flush();
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'idle' });
    expect(test.post).not.toHaveBeenCalled();
    expect(test.saveId).not.toHaveBeenCalled();
  });
});