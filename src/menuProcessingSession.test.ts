import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RestaurantMenu } from './data/menus';
import type { ImagePreparationQueue } from './imagePreparationQueue';
import { createMenuProcessingSession, type MenuProcessingJob } from './menuProcessingSession';
import type { PossibleMenu } from './menuSearchApi';

const menu: RestaurantMenu = { restaurantName: 'New Cafe', sections: [{ name: 'Dinner', items: ['Soup $8'] }] };
const onlineJob: MenuProcessingJob = { kind: 'online', query: 'Original dinner query', menu: {
  venue_identifier: 'New Cafe', menu_identifier: 'Dinner', source_url: 'https://example.test/menu.pdf',
  agent_instructions: 'PRIVATE extraction guidance',
} };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const pending = deferred<RestaurantMenu>();
  const onChange = vi.fn();
  const onMenu = vi.fn();
  const requests = { images: vi.fn(async (_images: Blob[], _signal: AbortSignal) => pending.promise),
    online: vi.fn(async (_query: string, _menu: PossibleMenu, _signal: AbortSignal) => pending.promise) };
  const session = createMenuProcessingSession(onChange, onMenu, requests);
  return { session, pending, requests, onChange, onMenu };
}

async function flush() { for (let index = 0; index < 6; index++) await Promise.resolve(); }
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('shared menu processing lifecycle', () => {
  it('loads one selected menu using a snapshot of the original query and suppresses duplicates', async () => {
    const test = harness();
    const input = structuredClone(onlineJob);
    expect(test.session.start(input)).toBe(true);
    expect(test.session.start(onlineJob)).toBe(false);
    input.query = 'Edited draft';
    input.menu.agent_instructions = 'Changed guidance';
    expect(test.requests.online).toHaveBeenCalledExactlyOnceWith(onlineJob.query, onlineJob.menu, expect.any(AbortSignal));
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'loading', kind: 'online' });
    expect(test.onMenu).not.toHaveBeenCalled();
    test.pending.resolve(menu);
    await flush();
    expect(test.onMenu).toHaveBeenCalledExactlyOnceWith(menu);
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'idle' });
    expect(vi.getTimerCount()).toBe(0);
    expect(test.session.retry()).toBe(false);
  });

  it('retains the selected menu after a recoverable error and retries without searching again', async () => {
    const test = harness();
    test.requests.online.mockRejectedValueOnce(new Error('Try another match'));
    test.session.start(onlineJob);
    await flush();
    expect(test.onMenu).not.toHaveBeenCalled();
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'error', kind: 'online', message: 'Try another match' });
    expect(test.session.retry()).toBe(true);
    expect(test.requests.online).toHaveBeenCalledTimes(2);
    test.pending.resolve(menu);
    await flush();
    expect(test.onMenu).toHaveBeenCalledExactlyOnceWith(menu);
  });

  it.each(['cancel', 'dispose'] as const)('revokes ownership on %s and ignores late success', async (action) => {
    const test = harness();
    test.session.start(onlineJob);
    const signal = test.requests.online.mock.calls[0][2];
    const calls = test.onChange.mock.calls.length;
    test.session[action]();
    expect(signal.aborted).toBe(true);
    expect(test.session.retry()).toBe(false);
    test.pending.resolve(menu);
    await flush();
    expect(test.onMenu).not.toHaveBeenCalled();
    expect(test.onChange.mock.calls.length).toBe(calls + (action === 'cancel' ? 1 : 0));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('publishes timeout immediately and protects a retry from the old response and finally', async () => {
    const test = harness();
    const newer = deferred<RestaurantMenu>();
    test.requests.online.mockImplementationOnce(async () => test.pending.promise)
      .mockImplementationOnce(async () => newer.promise);
    test.session.start(onlineJob);
    await vi.advanceTimersByTimeAsync(35_000);
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'error', kind: 'online',
      message: 'Reading the menu took too long. Please retry or choose another menu.' });
    expect(test.requests.online.mock.calls[0][2].aborted).toBe(true);
    expect(test.session.retry()).toBe(true);
    test.pending.resolve({ ...menu, restaurantName: 'Stale menu' });
    await flush();
    expect(test.onMenu).not.toHaveBeenCalled();
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'loading', kind: 'online' });
    expect(vi.getTimerCount()).toBe(1);
    newer.resolve(menu);
    await flush();
    expect(test.onMenu).toHaveBeenCalledExactlyOnceWith(menu);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves image preparation outside the network timeout and disposes photos on success', async () => {
    const test = harness();
    const prepared = deferred<Blob[]>();
    const queue = { collect: vi.fn(() => prepared.promise), dispose: vi.fn() };
    test.session.start({ kind: 'images', queue: queue as unknown as ImagePreparationQueue });
    await vi.advanceTimersByTimeAsync(70_000);
    expect(test.requests.images).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    const photos = [new Blob(['jpeg'])];
    prepared.resolve(photos);
    await flush();
    expect(test.requests.images).toHaveBeenCalledExactlyOnceWith(photos, expect.any(AbortSignal));
    expect(vi.getTimerCount()).toBe(1);
    test.pending.resolve(menu);
    await flush();
    expect(queue.dispose).toHaveBeenCalledOnce();
    expect(test.onMenu).toHaveBeenCalledExactlyOnceWith(menu);
  });

  it('disposes retained photos when replacing a failed image job with an online job', async () => {
    const test = harness();
    test.requests.images.mockRejectedValueOnce(new Error('Image error'));
    const queue = { collect: vi.fn(async () => [new Blob(['jpeg'])]), dispose: vi.fn() };
    test.session.start({ kind: 'images', queue: queue as unknown as ImagePreparationQueue });
    await flush();
    expect(queue.dispose).not.toHaveBeenCalled();
    test.session.start(onlineJob);
    expect(queue.dispose).toHaveBeenCalledOnce();
    test.session.cancel();
    test.pending.reject(new Error('Late failure'));
    await flush();
    expect(test.onMenu).not.toHaveBeenCalled();
    expect(test.onChange).toHaveBeenLastCalledWith({ status: 'idle' });
  });
});