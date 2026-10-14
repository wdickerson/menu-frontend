import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoundaryThump } from './boundaryThump';

function mockAudio(src: string) {
  return {
    src, preload: '', onended: null as (() => void) | null,
    onerror: null as (() => void) | null, onpause: null as (() => void) | null,
    play: vi.fn(() => Promise.resolve()), pause: vi.fn(), load: vi.fn(),
    removeAttribute: vi.fn(),
  };
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
    session = { type: 'auto' };
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
    expect(clips[0].load).toHaveBeenCalledOnce();
    expect(clips[0].play).not.toHaveBeenCalled();
    expect(session.type).toBe('auto');
    const playing = thump.play();
    // This assertion deliberately precedes await: iOS requires gesture activation.
    expect(clips[0].play).toHaveBeenCalledOnce();
    expect(constructor).toHaveBeenCalledOnce();
    expect(session.type).toBe('playback');
    await playing;
    clips[0].onended?.();
    expect(clips[0].pause).toHaveBeenCalledOnce();
    expect(clips[0].removeAttribute).toHaveBeenCalledWith('src');
    expect(clips[0].load).toHaveBeenCalledTimes(2);
    expect(session.type).toBe('auto');
  });

  it.each(['cancel', 'dispose'] as const)('aborts pending playback on %s and ignores late fulfillment', async (action) => {
    const playback = deferred();
    clips[0].play.mockReturnValue(playback.promise);
    const playing = thump.play();
    thump[action]();
    expect(clips[0].pause).toHaveBeenCalledOnce();
    expect(clips[0].removeAttribute).toHaveBeenCalledWith('src');
    expect(session.type).toBe('auto');
    playback.resolve();
    await playing;
    expect(clips[0].play).toHaveBeenCalledOnce();
    expect(clips[0].pause).toHaveBeenCalledTimes(2);
    expect(session.type).toBe('auto');
  });

  it.each(['resolve', 'reject'] as const)('ignores stale playback %s and old events during a newer thump', async (result) => {
    const playback = deferred();
    clips[0].play.mockReturnValue(playback.promise);
    const oldPlaying = thump.play();
    const oldEnded = clips[0].onended;
    const oldError = clips[0].onerror;
    const oldPause = clips[0].onpause;
    await thump.play();
    expect(constructor).toHaveBeenCalledTimes(2);
    expect(clips[0].pause).toHaveBeenCalledOnce();
    if (result === 'resolve') playback.resolve();
    else playback.reject(new Error('Aborted'));
    await oldPlaying;
    oldEnded?.();
    oldError?.();
    oldPause?.();
    expect(clips[1].play).toHaveBeenCalledOnce();
    expect(clips[1].pause).not.toHaveBeenCalled();
    expect(session.type).toBe('playback');
  });

  it('uses a fresh clip for each thump, including after natural completion', async () => {
    await thump.play();
    clips[0].onended?.();
    await thump.play();
    expect(clips[0].play).toHaveBeenCalledOnce();
    expect(clips[1].play).toHaveBeenCalledOnce();
    thump.cancel();
    expect(clips[1].pause).toHaveBeenCalledOnce();
    expect(session.type).toBe('auto');
  });

  it.each(['reject', 'throw'])('safely handles playback %s and retries only on the next gesture', async (failure) => {
    clips[0].play.mockImplementationOnce(() => {
      if (failure === 'throw') throw new Error('Blocked');
      return Promise.reject(new Error('Blocked'));
    });
    await expect(thump.play()).resolves.toBeUndefined();
    expect(clips[0].pause).toHaveBeenCalledOnce();
    expect(session.type).toBe('auto');
    await thump.play();
    expect(clips[1].play).toHaveBeenCalledOnce();
  });

  it.each(['onerror', 'onpause'] as const)('cancels on %s without resuming automatically', async (event) => {
    await thump.play();
    clips[0][event]?.();
    expect(clips[0].pause).toHaveBeenCalledOnce();
    expect(session.type).toBe('auto');
    expect(clips[0].play).toHaveBeenCalledOnce();
    await thump.play();
    expect(clips[1].play).toHaveBeenCalledOnce();
  });

  it.each(['visibilitychange', 'pagehide'])('cancels pending playback on %s without replay on return', async (event) => {
    const playback = deferred();
    clips[0].play.mockReturnValue(playback.promise);
    const playing = thump.play();
    if (event === 'visibilitychange') {
      documentTarget.hidden = true;
      documentTarget.dispatchEvent(new Event(event));
    } else windowTarget.dispatchEvent(new Event(event));
    expect(clips[0].pause).toHaveBeenCalledOnce();
    expect(session.type).toBe('auto');
    documentTarget.hidden = false;
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    playback.resolve();
    await playing;
    expect(constructor).toHaveBeenCalledOnce();
    expect(clips[0].play).toHaveBeenCalledOnce();
    await thump.play();
    expect(clips[1].play).toHaveBeenCalledOnce();
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
    expect(clips[1].pause).toHaveBeenCalledOnce();
    expect(session.type).toBe('auto');
  });
});
