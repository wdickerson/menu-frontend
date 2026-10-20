import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PossibleMenu } from './menuSearchApi';
import { createMenuSearchSession, type MenuSearchState } from './menuSearchSession';

const menus: PossibleMenu[] = [{ venue_identifier: 'Rough & Tumble Columbia City',
  menu_identifier: 'Dinner', source_url: 'https://example.test/menu.pdf',
  agent_instructions: 'Read https://example.test/menu.pdf' }];
const canceledMessage = 'Search canceled. Go back to search again.';
const timeoutMessage = 'Searching took too long. Go back and try again.';

function deferred() {
  let resolve!: (value: PossibleMenu[]) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<PossibleMenu[]>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createDelayedSession() {
  const pending = deferred();
  const request = vi.fn((_query: string, _signal: AbortSignal) => pending.promise);
  const change = vi.fn<(state: MenuSearchState) => void>();
  const session = createMenuSearchSession(change, request);
  return { session, pending, request, change };
}

async function settle(pending: ReturnType<typeof deferred>, outcome: 'response' | 'rejection') {
  if (outcome === 'response') pending.resolve(menus);
  else pending.reject(new Error('Late transport failure'));
  await Promise.resolve();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('menu search session lifecycle', () => {
  it('does not request, notify, or schedule anything until explicitly started', () => {
    const { session, request, change } = createDelayedSession();
    session.cancel();
    session.cancel(false);
    expect(request).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('immediately publishes loading and prevents duplicate starts, including a different query', async () => {
    const { session, pending, request, change } = createDelayedSession();
    expect(session.start('Dinner in Columbia City')).toBe(true);
    expect(change).toHaveBeenCalledExactlyOnceWith({ status: 'loading', query: 'Dinner in Columbia City' });
    expect(request).toHaveBeenCalledExactlyOnceWith('Dinner in Columbia City', expect.any(AbortSignal));
    expect(request.mock.calls[0][1].aborted).toBe(false);
    expect(session.start('Dinner in Columbia City')).toBe(false);
    expect(session.start('Another menu')).toBe(false);
    expect(request).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    pending.resolve(menus);
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([{ label: 'matching menus', results: menus }, { label: 'no matches', results: [] }])
    ('publishes $label on success, clears its timer, and allows another search', async ({ results }) => {
    const { session, pending, request, change } = createDelayedSession();
    session.start('Dinner');
    pending.resolve(results);
    await Promise.resolve();
    expect(change.mock.calls).toEqual([
      [{ status: 'loading', query: 'Dinner' }], [{ status: 'complete', query: 'Dinner', menus: results }],
    ]);
    expect(request.mock.calls[0][1].aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(70_000);
    session.cancel();
    expect(change).toHaveBeenCalledTimes(2);
    expect(session.start('Lunch')).toBe(true);
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    expect(change).toHaveBeenLastCalledWith({ status: 'complete', query: 'Lunch', menus: results });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { label: 'a service error', error: new Error('Search is temporarily unavailable.'), message: 'Search is temporarily unavailable.' },
    { label: 'a network TypeError', error: new TypeError('PRIVATE_TRANSPORT_DETAILS'),
      message: 'Could not reach the menu search service. Check your connection and try again.' },
    { label: 'a non-Error rejection', error: 'PRIVATE_PROVIDER_DETAILS', message: 'Menus could not be searched. Please try again.' },
    { label: 'a null rejection', error: null, message: 'Menus could not be searched. Please try again.' },
  ])('publishes a recoverable error for $label and clears its timer', async ({ error, message }) => {
    const { session, pending, change } = createDelayedSession();
    session.start('Dinner');
    pending.reject(error);
    await Promise.resolve();
    expect(change.mock.calls).toEqual([
      [{ status: 'loading', query: 'Dinner' }], [{ status: 'error', query: 'Dinner', message }],
    ]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(70_000);
    session.cancel();
    expect(change).toHaveBeenCalledTimes(2);
    expect(session.start('Retry dinner')).toBe(true);
    session.cancel(false);
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles a synchronously thrown request error and permits an immediate retry', () => {
    const change = vi.fn();
    const request = vi.fn((_query: string, _signal: AbortSignal): Promise<PossibleMenu[]> => {
      throw new Error('Invalid menu description.');
    });
    const session = createMenuSearchSession(change, request);
    expect(session.start('Dinner')).toBe(true);
    expect(change.mock.calls).toEqual([
      [{ status: 'loading', query: 'Dinner' }],
      [{ status: 'error', query: 'Dinner', message: 'Invalid menu description.' }],
    ]);
    expect(vi.getTimerCount()).toBe(0);
    expect(session.start('Lunch')).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('menu search cancellation and request ownership', () => {
  it('aborts and reports explicit cancellation once, without leaving a timer', async () => {
    const { session, pending, request, change } = createDelayedSession();
    session.start('Dinner');
    const abortSignal = request.mock.calls[0][1];
    const aborted = vi.fn();
    abortSignal.addEventListener('abort', aborted);
    session.cancel();
    expect(abortSignal.aborted).toBe(true);
    expect(aborted).toHaveBeenCalledOnce();
    expect(change.mock.calls).toEqual([
      [{ status: 'loading', query: 'Dinner' }],
      [{ status: 'error', query: 'Dinner', message: canceledMessage }],
    ]);
    expect(vi.getTimerCount()).toBe(0);
    session.cancel();
    session.cancel(false);
    pending.reject(abortSignal.reason);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(70_000);
    expect(change).toHaveBeenCalledTimes(2);
    expect(aborted).toHaveBeenCalledOnce();
  });

  it('silently aborts during unmount cleanup even when abort immediately rejects the request', async () => {
    const change = vi.fn();
    const request = vi.fn((_query: string, abortSignal: AbortSignal) => new Promise<PossibleMenu[]>((_resolve, reject) => {
      abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true });
    }));
    const session = createMenuSearchSession(change, request);
    session.start('Dinner');
    session.cancel(false);
    expect(request.mock.calls[0][1].aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(70_000);
    expect(change).toHaveBeenCalledExactlyOnceWith({ status: 'loading', query: 'Dinner' });
  });

  it.each([
    { notify: true, outcome: 'response' as const }, { notify: true, outcome: 'rejection' as const },
    { notify: false, outcome: 'response' as const }, { notify: false, outcome: 'rejection' as const },
  ])('ignores a late $outcome after cancel(notify=$notify) from transport that ignores abort', async ({ notify, outcome }) => {
    const { session, pending, request, change } = createDelayedSession();
    session.start('Dinner');
    session.cancel(notify);
    expect(request.mock.calls[0][1].aborted).toBe(true);
    const notifications = change.mock.calls.slice();
    expect(notifications).toHaveLength(notify ? 2 : 1);
    await settle(pending, outcome);
    await vi.advanceTimersByTimeAsync(70_000);
    expect(change.mock.calls).toEqual(notifications);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['response', 'rejection'] as const)('does not let an old $outcome clear or overwrite a newer active request', async (outcome) => {
    const older = deferred();
    const newer = deferred();
    const change = vi.fn();
    const request = vi.fn<(_query: string, _signal: AbortSignal) => Promise<PossibleMenu[]>>()
      .mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const session = createMenuSearchSession(change, request);
    session.start('Old dinner');
    await vi.advanceTimersByTimeAsync(10_000);
    session.cancel(false);
    expect(session.start('New lunch')).toBe(true);
    const newSignal = request.mock.calls[1][1];
    await settle(older, outcome);
    expect(change.mock.calls).toEqual([
      [{ status: 'loading', query: 'Old dinner' }], [{ status: 'loading', query: 'New lunch' }],
    ]);
    expect(newSignal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    expect(session.start('Duplicate lunch')).toBe(false);
    newer.resolve(menus);
    await Promise.resolve();
    expect(change).toHaveBeenLastCalledWith({ status: 'complete', query: 'New lunch', menus });
    expect(change).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['response', 'rejection'] as const)('does not overwrite a newer completed search with an old $outcome', async (outcome) => {
    const older = deferred();
    const newer = deferred();
    const change = vi.fn();
    const request = vi.fn<(_query: string, _signal: AbortSignal) => Promise<PossibleMenu[]>>()
      .mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const session = createMenuSearchSession(change, request);
    session.start('Old dinner');
    session.cancel(false);
    session.start('New lunch');
    newer.resolve([]);
    await Promise.resolve();
    expect(change).toHaveBeenLastCalledWith({ status: 'complete', query: 'New lunch', menus: [] });
    const notifications = change.mock.calls.slice();
    await settle(older, outcome);
    await vi.advanceTimersByTimeAsync(70_000);
    expect(change.mock.calls).toEqual(notifications);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('menu search timeout', () => {
  it('aborts exactly at 35 seconds, emits one timeout, and clears the timer', async () => {
    const { session, pending, request, change } = createDelayedSession();
    session.start('Dinner');
    const abortSignal = request.mock.calls[0][1];
    await vi.advanceTimersByTimeAsync(34_999);
    expect(abortSignal.aborted).toBe(false);
    expect(change).toHaveBeenCalledExactlyOnceWith({ status: 'loading', query: 'Dinner' });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(abortSignal.aborted).toBe(true);
    expect(change).toHaveBeenLastCalledWith({ status: 'error', query: 'Dinner', message: timeoutMessage });
    expect(change).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    session.cancel();
    pending.reject(abortSignal.reason);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(70_000);
    expect(change).toHaveBeenCalledTimes(2);
  });

  it('does not replace a timeout with the transport abort error', async () => {
    const change = vi.fn();
    const request = vi.fn((_query: string, abortSignal: AbortSignal) => new Promise<PossibleMenu[]>((_resolve, reject) => {
      abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true });
    }));
    const session = createMenuSearchSession(change, request);
    session.start('Dinner');
    await vi.advanceTimersByTimeAsync(35_000);
    expect(change.mock.calls).toEqual([
      [{ status: 'loading', query: 'Dinner' }],
      [{ status: 'error', query: 'Dinner', message: timeoutMessage }],
    ]);
    expect(request.mock.calls[0][1].aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['response', 'rejection'] as const)('ignores a late $outcome after timeout and protects a retry with its own full deadline', async (outcome) => {
    const older = deferred();
    const newer = deferred();
    const change = vi.fn();
    const request = vi.fn<(_query: string, _signal: AbortSignal) => Promise<PossibleMenu[]>>()
      .mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const session = createMenuSearchSession(change, request);
    session.start('Old dinner');
    await vi.advanceTimersByTimeAsync(35_000);
    expect(session.start('Retry dinner')).toBe(true);
    const newSignal = request.mock.calls[1][1];
    await settle(older, outcome);
    expect(change).toHaveBeenCalledTimes(3);
    expect(change).toHaveBeenLastCalledWith({ status: 'loading', query: 'Retry dinner' });
    expect(session.start('Duplicate retry')).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(34_999);
    expect(newSignal.aborted).toBe(false);
    expect(change).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(newSignal.aborted).toBe(true);
    expect(change).toHaveBeenCalledTimes(4);
    expect(change).toHaveBeenLastCalledWith({ status: 'error', query: 'Retry dinner', message: timeoutMessage });
    expect(vi.getTimerCount()).toBe(0);
    newer.resolve(menus);
    await Promise.resolve();
    expect(change).toHaveBeenCalledTimes(4);
  });

  it.each(['response', 'rejection'] as const)('clears the deadline when a $outcome arrives just before timeout', async (outcome) => {
    const { session, pending, request, change } = createDelayedSession();
    session.start('Dinner');
    await vi.advanceTimersByTimeAsync(34_999);
    await settle(pending, outcome);
    expect(change).toHaveBeenCalledTimes(2);
    expect(change).toHaveBeenLastCalledWith(outcome === 'response'
      ? { status: 'complete', query: 'Dinner', menus }
      : { status: 'error', query: 'Dinner', message: 'Late transport failure' });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(request.mock.calls[0][1].aborted).toBe(false);
    expect(change).toHaveBeenCalledTimes(2);
  });
});