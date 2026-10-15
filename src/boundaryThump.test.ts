import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoundaryThump } from './boundaryThump';

function mockAudio(src: string) {
  let position = 0;
  const clip = {
    src, preload: '', onended: null as (() => void) | null,
    onerror: null as (() => void) | null, onpause: null as (() => void) | null,
    paused: true, ended: false, error: null as { code: number } | null,
    get currentTime(): number { return position; },
    set currentTime(value: number) { position = value; clip.ended = false; },
    play: vi.fn(() => { clip.paused = false; return Promise.resolve(); }),
    pause: vi.fn(() => { clip.paused = true; }),
    load: vi.fn(() => { clip.error = null; }),
    removeAttribute: vi.fn(),
  };
  return clip;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('bundled boundary thump', () => {
  let clips: Array<ReturnType<typeof mockAudio>>;
  let constructor: ReturnType<typeof vi.fn>;
  let session: { type: string };
  let documentTarget: EventTarget & { hidden: boolean };
  let windowTarget: EventTarget;
  let thump: ReturnType<typeof createBoundaryThump>;

  beforeEach(() => {
    clips = [];
    constructor = vi.fn(function (src: string) {
      const audio = mockAudio(src);
      clips.push(audio);
      return audio;
    });
    let sessionType = 'auto';
    session = { get type() { return sessionType; }, set type(value) { sessionType = value; } };
    documentTarget = Object.assign(new EventTarget(), { hidden: false });
    windowTarget = new EventTarget();
    vi.stubGlobal('Audio', constructor);
    vi.stubGlobal('navigator', { audioSession: session });
    vi.stubGlobal('document', documentTarget);
    vi.stubGlobal('window', windowTarget);
    thump = createBoundaryThump();
  });
  afterEach(() => {
    thump.dispose();
    vi.unstubAllGlobals();
  });

  it('preloads the base-path-safe asset without autoplay, then plays inside the gesture', async () => {
    expect(clips[0].src).toBe(`${import.meta.env.BASE_URL}assets/boundary-thump.wav`);
    expect(clips[0].preload).toBe('auto');
    expect(clips[0].load).not.toHaveBeenCalled();
    expect(clips[0].play).not.toHaveBeenCalled();
    expect(session.type).toBe('auto');
    const playing = thump.play();
    // This assertion deliberately precedes await: iOS requires gesture activation.
    expect(clips[0].play).toHaveBeenCalledOnce();
    expect(constructor).toHaveBeenCalledOnce();
    expect(session.type).toBe('playback');
    await playing;
    clips[0].ended = true;
    clips[0].onended?.();
    expect(clips[0].paused).toBe(true);
    expect(clips[0].removeAttribute).not.toHaveBeenCalled();
    expect(clips[0].load).not.toHaveBeenCalled();
    expect(session.type).toBe('playback');
  });

  it.each(['cancel', 'dispose'] as const)('aborts pending playback on %s and ignores late fulfillment', async (action) => {
    const playback = deferred();
    clips[0].play.mockReturnValue(playback.promise);
    const playing = thump.play();
    thump[action]();
    expect(clips[0].paused).toBe(true);
    expect(clips[0].removeAttribute).toHaveBeenCalledTimes(action === 'dispose' ? 1 : 0);
    expect(session.type).toBe(action === 'dispose' ? 'auto' : 'playback');
    playback.resolve();
    await playing;
    expect(clips[0].play).toHaveBeenCalledOnce();
    expect(clips[0].pause).toHaveBeenCalledTimes(2);
    expect(session.type).toBe(action === 'dispose' ? 'auto' : 'playback');
  });

  it.each(['resolve', 'reject'] as const)('ignores stale playback %s and old events during a newer thump', async (result) => {
    const playback = deferred();
    clips[0].play.mockReturnValueOnce(playback.promise);
    const oldPlaying = thump.play();
    const oldEnded = clips[0].onended;
    const oldError = clips[0].onerror;
    const oldPause = clips[0].onpause;
    await thump.play();
    expect(constructor).toHaveBeenCalledOnce();
    const pauseCount = clips[0].pause.mock.calls.length;
    if (result === 'resolve') playback.resolve();
    else playback.reject(new Error('Aborted'));
    await oldPlaying;
    oldEnded?.();
    oldError?.();
    oldPause?.();
    expect(clips[0].play).toHaveBeenCalledTimes(2);
    expect(clips[0].pause).toHaveBeenCalledTimes(pauseCount);
    expect(clips[0].paused).toBe(false);
    expect(session.type).toBe('playback');
  });

  it('reuses the same element and rewinds through repeated thump/speech cycles', async () => {
    const sessionSetter = vi.spyOn(session, 'type', 'set');
    for (let index = 0; index < 30; index += 1) {
      await thump.play();
      expect(clips[0].currentTime).toBe(0);
      clips[0].currentTime = 0.2;
      clips[0].ended = true;
      clips[0].onended?.();
      thump.cancel(); // The unchanged speech path calls cancel before speaking.
    }
    expect(constructor).toHaveBeenCalledOnce();
    expect(clips[0].play).toHaveBeenCalledTimes(30);
    expect(clips[0].load).not.toHaveBeenCalled();
    expect(clips[0].removeAttribute).not.toHaveBeenCalled();
    expect(sessionSetter).toHaveBeenCalledExactlyOnceWith('playback');
    thump.cancel();
    expect(session.type).toBe('playback');
    thump.dispose();
    expect(sessionSetter).toHaveBeenLastCalledWith('auto');
    expect(session.type).toBe('auto');
  });

  it.each(['reject', 'throw'])('safely handles playback %s and retries only on the next gesture', async (failure) => {
    clips[0].play.mockImplementationOnce(() => {
      if (failure === 'throw') throw new Error('Blocked');
      return Promise.reject(new Error('Blocked'));
    });
    await expect(thump.play()).resolves.toBeUndefined();
    expect(clips[0].paused).toBe(true);
    await thump.play();
    expect(clips[0].play).toHaveBeenCalledTimes(2);
  });

  it.each(['onerror', 'onpause'] as const)('cancels on %s without resuming automatically', async (event) => {
    await thump.play();
    if (event === 'onerror') clips[0].error = { code: 3 };
    else clips[0].paused = true;
    clips[0][event]?.();
    expect(clips[0].paused).toBe(true);
    expect(clips[0].play).toHaveBeenCalledOnce();
    expect(clips[0].load).not.toHaveBeenCalled();
    await thump.play();
    expect(clips[0].play).toHaveBeenCalledTimes(2);
    expect(clips[0].load).toHaveBeenCalledTimes(event === 'onerror' ? 1 : 0);
  });

  it('does not unload the clip when natural completion emits pause before ended', async () => {
    await thump.play();
    clips[0].paused = clips[0].ended = true;
    clips[0].onpause?.();
    clips[0].onended?.();
    expect(clips[0].removeAttribute).not.toHaveBeenCalled();
    expect(clips[0].load).not.toHaveBeenCalled();
    await thump.play();
    expect(clips[0].paused).toBe(false);
    expect(clips[0].currentTime).toBe(0);
  });

  it.each(['visibilitychange', 'pagehide'])('cancels pending playback on %s without replay on return', async (event) => {
    const playback = deferred();
    clips[0].play.mockReturnValue(playback.promise);
    const playing = thump.play();
    if (event === 'visibilitychange') {
      documentTarget.hidden = true;
      documentTarget.dispatchEvent(new Event(event));
    } else windowTarget.dispatchEvent(new Event(event));
    expect(clips[0].paused).toBe(true);
    documentTarget.hidden = false;
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    playback.resolve();
    await playing;
    expect(constructor).toHaveBeenCalledOnce();
    expect(clips[0].play).toHaveBeenCalledOnce();
    await thump.play();
    expect(clips[0].play).toHaveBeenCalledTimes(2);
  });

  it('does not start media while hidden or after disposal', async () => {
    documentTarget.hidden = true;
    await thump.play();
    expect(clips[0].play).not.toHaveBeenCalled();
    thump.dispose();
    documentTarget.hidden = false;
    await thump.play();
    expect(constructor).toHaveBeenCalledOnce();
    expect(clips[0].play).not.toHaveBeenCalled();
  });

  it.each(['missing', 'getter throws', 'setter throws'])('feature-detects audioSession safely: %s', async (kind) => {
    const browserNavigator = kind === 'missing' ? {} : Object.defineProperty({}, 'audioSession', {
      get() {
        if (kind === 'getter throws') throw new Error('Unavailable');
        return Object.defineProperty({}, 'type', {
          get: () => 'ambient', set: () => { throw new Error('Read only'); },
        });
      },
    });
    vi.stubGlobal('navigator', browserNavigator);
    await expect(thump.play()).resolves.toBeUndefined();
    expect(clips[0].play).toHaveBeenCalledOnce();
    expect(() => thump.dispose()).not.toThrow();
  });

  it('restores the exact session value even when media cleanup throws', async () => {
    session.type = 'ambient';
    await thump.play();
    clips[0].pause.mockImplementationOnce(() => { throw new Error('Unavailable'); });
    clips[0].load.mockImplementationOnce(() => { throw new Error('Unavailable'); });
    expect(() => thump.dispose()).not.toThrow();
    expect(session.type).toBe('ambient');
  });

  it('handles unavailable/throwing media APIs without breaking navigation', async () => {
    thump.dispose();
    vi.stubGlobal('Audio', undefined);
    thump = createBoundaryThump();
    await expect(thump.play()).resolves.toBeUndefined();
    constructor.mockImplementationOnce(() => { throw new Error('Unavailable'); });
    vi.stubGlobal('Audio', constructor);
    await expect(thump.play()).resolves.toBeUndefined();
    await thump.play();
    expect(clips[1].play).toHaveBeenCalledOnce();
  });

  it('releases unused preloads and all listeners in Strict Mode setup-cleanup-setup', async () => {
    const removeDocumentListener = vi.spyOn(documentTarget, 'removeEventListener');
    const removeWindowListener = vi.spyOn(windowTarget, 'removeEventListener');
    thump.dispose();
    expect(clips[0].pause).toHaveBeenCalledOnce();
    expect(clips[0].removeAttribute).toHaveBeenCalledWith('src');
    expect(removeDocumentListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith('pagehide', expect.any(Function));
    thump = createBoundaryThump();
    await thump.play();
    expect(clips[1].play).toHaveBeenCalledOnce();
    thump.dispose();
    expect(clips[1].paused).toBe(true);
    expect(session.type).toBe('auto');
  });
});
