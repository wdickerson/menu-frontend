import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepScreenAwake } from './screenWakeLock';

class Page extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';

  setVisibility(state: DocumentVisibilityState) {
    this.visibilityState = state;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

function createLock() {
  const sentinel = {
    released: false,
    release: vi.fn(async () => { sentinel.released = true; }),
  };
  return sentinel;
}

function setup(page = new Page()) {
  const lock = createLock();
  const request = vi.fn<WakeLock['request']>().mockResolvedValue(lock as unknown as WakeLockSentinel);
  const cleanup = keepScreenAwake(page, { request });
  return { page, lock, request, cleanup };
}

afterEach(() => vi.restoreAllMocks());

describe('Quick Nav screen wake lock', () => {
  it('holds a screen lock without requiring activity and releases it on exit', async () => {
    const { lock, request, cleanup } = setup();
    await Promise.resolve();
    expect(request).toHaveBeenCalledExactlyOnceWith('screen');
    expect(lock.release).not.toHaveBeenCalled();
    cleanup();
    expect(lock.release).toHaveBeenCalledOnce();
  });

  it('reacquires a browser-released lock when the page becomes visible', async () => {
    const { page, lock, request, cleanup } = setup();
    await Promise.resolve();
    page.setVisibility('hidden');
    lock.released = true;
    const nextLock = createLock();
    request.mockResolvedValue(nextLock as unknown as WakeLockSentinel);
    expect(request).toHaveBeenCalledOnce();
    page.setVisibility('visible');
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    cleanup();
    expect(nextLock.release).toHaveBeenCalledOnce();
  });

  it('does not request duplicate locks for visibility events', async () => {
    const { page, request, cleanup } = setup();
    page.setVisibility('visible');
    expect(request).toHaveBeenCalledOnce();
    await Promise.resolve();
    page.setVisibility('visible');
    expect(request).toHaveBeenCalledOnce();
    cleanup();
  });

  it('waits for visibility before acquiring a lock', async () => {
    const page = new Page();
    page.visibilityState = 'hidden';
    const { request, cleanup } = setup(page);
    expect(request).not.toHaveBeenCalled();
    page.setVisibility('visible');
    await Promise.resolve();
    expect(request).toHaveBeenCalledExactlyOnceWith('screen');
    cleanup();
  });

  it.each(['exit', 'hidden'])('releases a pending lock acquired after %s', async (reason) => {
    const { page, lock, cleanup } = setup();
    if (reason === 'exit') cleanup();
    else page.setVisibility('hidden');
    await Promise.resolve();
    expect(lock.release).toHaveBeenCalledOnce();
    cleanup();
  });

  it('ignores visibility events after cleanup, including Strict Mode remounts', async () => {
    const { page, lock, request, cleanup } = setup();
    cleanup();
    const nextLock = createLock();
    request.mockResolvedValue(nextLock as unknown as WakeLockSentinel);
    const nextCleanup = keepScreenAwake(page, { request });
    await Promise.resolve();
    expect(lock.release).toHaveBeenCalledOnce();
    expect(nextLock.release).not.toHaveBeenCalled();
    nextCleanup();
    expect(nextLock.release).toHaveBeenCalledOnce();
    page.setVisibility('visible');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('handles unsupported browsers', () => {
    const page = new Page();
    const cleanup = keepScreenAwake(page, undefined);
    expect(() => page.setVisibility('visible')).not.toThrow();
    expect(cleanup).not.toThrow();
  });

  it('handles denied requests and retries when visible again', async () => {
    const page = new Page();
    const request = vi.fn<WakeLock['request']>().mockRejectedValue(new Error('Not allowed'));
    const cleanup = keepScreenAwake(page, { request });
    await Promise.resolve();
    page.setVisibility('hidden');
    page.setVisibility('visible');
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it('handles release failures without interrupting exit', async () => {
    const { lock, cleanup } = setup();
    await Promise.resolve();
    lock.release.mockRejectedValue(new Error('Already released'));
    expect(cleanup).not.toThrow();
    await Promise.resolve();
  });
});