// Wake locks require a secure context and may be denied by the browser or OS.
// Keep Quick Nav usable even when keeping the screen awake is unavailable.
export function keepScreenAwake(
  page: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>,
  wakeLock: WakeLock | undefined,
) {
  let disposed = false;
  let pending = false;
  let lock: WakeLockSentinel | null = null;

  async function release(sentinel: WakeLockSentinel) {
    try {
      await sentinel.release();
    } catch {
      // The browser may already have released the lock.
    }
  }

  async function acquire() {
    if (disposed || !wakeLock || page.visibilityState !== 'visible'
      || pending || (lock && !lock.released)) return;

    pending = true;
    try {
      const acquired = await wakeLock.request('screen');
      if (disposed || page.visibilityState !== 'visible') {
        await release(acquired);
      } else {
        lock = acquired;
      }
    } catch {
      // Unsupported/denied requests must not interrupt menu navigation.
    } finally {
      pending = false;
    }
  }

  function handleVisibilityChange() {
    void acquire();
  }

  page.addEventListener('visibilitychange', handleVisibilityChange);
  void acquire();

  return () => {
    disposed = true;
    page.removeEventListener('visibilitychange', handleVisibilityChange);
    if (lock) void release(lock);
    lock = null;
  };
}