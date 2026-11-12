import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoundaryThump } from './boundaryThump';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function mockAudio(src: string) {
  let position = 0;
  const clip = {
    src, preload: '', paused: true, error: null as { code: number } | null,
    onended: null, onerror: null, onpause: null,
    get currentTime(): number { return position; },
    set currentTime(value: number) { position = value; },
    play: vi.fn(() => { clip.paused = false; return Promise.resolve(); }),
    pause: vi.fn(() => { clip.paused = true; }),
    load: vi.fn(() => { clip.error = null; }),
    removeAttribute: vi.fn(),
  };
  return clip;
}

describe('single-path bundled boundary thump', () => {
  let clips: Array<ReturnType<typeof mockAudio>>;
  let constructor: ReturnType<typeof vi.fn>;
  let documentTarget: EventTarget & { hidden: boolean };
  let windowTarget: EventTarget;
  let thump: ReturnType<typeof createBoundaryThump> | null;

  function open() {
    thump = createBoundaryThump();
    return thump;
  }

  beforeEach(() => {
    thump = null;
    clips = [];
    constructor = vi.fn(function (src: string) {
      const clip = mockAudio(src);
      clips.push(clip);
      return clip;
    });
    documentTarget = Object.assign(new EventTarget(), { hidden: false });
    windowTarget = new EventTarget();
    vi.stubGlobal('Audio', constructor);
    vi.stubGlobal('navigator', { userAgent: '', platform: '', maxTouchPoints: 0 });
    vi.stubGlobal('document', documentTarget);
    vi.stubGlobal('window', windowTarget);
  });

  afterEach(() => {
    thump?.dispose();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('preloads the base-path-safe recording without autoplay and invokes play directly in the gesture', async () => {
    const player = open();
    expect(constructor).toHaveBeenCalledExactlyOnceWith(`${import.meta.env.BASE_URL}assets/boundary-thump.wav`);
    expect(clips[0].preload).toBe('auto');
    expect(clips[0].play).not.toHaveBeenCalled();
    expect(clips[0].load).not.toHaveBeenCalled();
    const playing = player.play();
    // Before await: never wait for canplay, fetch, speech completion, or a timer.
    expect(clips[0].play).toHaveBeenCalledOnce();
    expect(clips[0].currentTime).toBe(0);
    await playing;
  });

  it.each([
    { device: 'iPhone Safari', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5, ios: true },
    { device: 'iPhone Chrome', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/130.0', platform: 'iPhone', maxTouchPoints: 5, ios: true },
    { device: 'iPad', userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', platform: 'iPad', maxTouchPoints: 5, ios: true },
    { device: 'iPod', userAgent: 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)', platform: 'iPod', maxTouchPoints: 5, ios: true },
    { device: 'desktop-mode iPad', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', platform: 'MacIntel', maxTouchPoints: 5, ios: true },
    { device: 'Mac', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', platform: 'MacIntel', maxTouchPoints: 0, ios: false },
    { device: 'Android', userAgent: 'Mozilla/5.0 (Linux; Android 15)', platform: 'Linux armv8l', maxTouchPoints: 5, ios: false },
    { device: 'touchscreen Windows', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 10, ios: false },
  ])('preloads only the chosen recording and uses the same player on $device', async ({ userAgent, platform, maxTouchPoints, ios }) => {
    vi.stubGlobal('navigator', { userAgent, platform, maxTouchPoints });
    const player = open();
    const expectedUrl = `${import.meta.env.BASE_URL}assets/boundary-thump${ios ? '-ios' : ''}.wav`;
    expect(constructor).toHaveBeenCalledExactlyOnceWith(expectedUrl);
    expect(clips[0].preload).toBe('auto');
    expect(clips[0].play).not.toHaveBeenCalled();
    for (let index = 0; index < 3; index += 1) {
      const playing = player.play();
      expect(clips[0].play).toHaveBeenCalledTimes(index + 1);
      await playing;
      player.cancel();
    }
    expect(constructor).toHaveBeenCalledOnce();
    expect(clips[0].src).toBe(expectedUrl);
    expect(clips[0].load).not.toHaveBeenCalled();
  });

  it('detects iOS once on entry, not on playback, cancellation, or media error recovery', async () => {
    const userAgent = vi.fn(() => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)');
    const platform = vi.fn(() => 'MacIntel');
    const maxTouchPoints = vi.fn(() => 5);
    vi.stubGlobal('navigator', Object.defineProperties({}, {
      userAgent: { get: userAgent }, platform: { get: platform }, maxTouchPoints: { get: maxTouchPoints },
    }));
    const player = open();
    userAgent.mockReturnValue('Android');
    platform.mockReturnValue('Linux');
    maxTouchPoints.mockReturnValue(0);
    for (let index = 0; index < 30; index += 1) {
      clips[0].currentTime = 0.2;
      clips[0].error = { code: 3 };
      await player.play();
      player.cancel();
    }
    player.dispose();
    expect(userAgent).toHaveBeenCalledOnce();
    expect(platform).toHaveBeenCalledOnce();
    expect(maxTouchPoints).toHaveBeenCalledOnce();
    expect(constructor).toHaveBeenCalledExactlyOnceWith(`${import.meta.env.BASE_URL}assets/boundary-thump-ios.wav`);
  });

  it('retains the selected file when element construction is retried', async () => {
    const userAgent = vi.fn(() => 'iPhone');
    vi.stubGlobal('navigator', Object.defineProperty({}, 'userAgent', { get: userAgent }));
    constructor.mockImplementationOnce(() => { throw new Error('Unavailable'); });
    const player = open();
    expect(clips).toHaveLength(0);
    userAgent.mockReturnValue('Android');
    await player.play();
    expect(userAgent).toHaveBeenCalledOnce();
    expect(constructor).toHaveBeenCalledTimes(2);
    expect(constructor.mock.calls.map(([url]) => url)).toEqual([
      `${import.meta.env.BASE_URL}assets/boundary-thump-ios.wav`,
      `${import.meta.env.BASE_URL}assets/boundary-thump-ios.wav`,
    ]);
    expect(clips[0].play).toHaveBeenCalledOnce();
  });

  it('uses the standard recording when navigator is unavailable', async () => {
    vi.stubGlobal('navigator', undefined);
    const player = open();
    await player.play();
    expect(constructor).toHaveBeenCalledExactlyOnceWith(`${import.meta.env.BASE_URL}assets/boundary-thump.wav`);
  });

  it('never uses Web Audio, manual fetch, or audio-session overrides', async () => {
    const unsupported = vi.fn(() => { throw new Error('No extra audio paths'); });
    Object.defineProperty(windowTarget, 'AudioContext', { get: unsupported });
    vi.stubGlobal('fetch', unsupported);
    vi.stubGlobal('navigator', Object.defineProperties({ userAgent: 'iPhone' }, {
      audioSession: { get: unsupported },
    }));
    const player = open();
    await player.play();
    expect(clips[0].play).toHaveBeenCalledOnce();
    expect(unsupported).not.toHaveBeenCalled();
  });

  it('does not require seeking on a cold first cue before metadata is available', async () => {
    const player = open();
    const seek = vi.spyOn(clips[0], 'currentTime', 'set')
      .mockImplementation(() => { throw new Error('Metadata not loaded'); });
    await player.play();
    expect(seek).not.toHaveBeenCalled();
    expect(clips[0].play).toHaveBeenCalledOnce();
  });

  it('has only page lifecycle listeners, with no silent playback or gesture warmup machinery', async () => {
    const documentListener = vi.spyOn(documentTarget, 'addEventListener');
    const windowListener = vi.spyOn(windowTarget, 'addEventListener');
    open();
    expect(documentListener).toHaveBeenCalledExactlyOnceWith('visibilitychange', expect.any(Function));
    expect(windowListener).toHaveBeenCalledExactlyOnceWith('pagehide', expect.any(Function));
    for (const event of ['pointerup', 'touchend', 'keydown', 'keyup', 'click']) {
      documentTarget.dispatchEvent(new Event(event));
    }
    await Promise.resolve();
    expect(clips[0].play).not.toHaveBeenCalled();
    expect(clips[0].onended).toBeNull();
    expect(clips[0].onerror).toBeNull();
    expect(clips[0].onpause).toBeNull();
  });

  it('reuses and rewinds one element through repeated speech/cue cycles', async () => {
    const player = open();
    for (let index = 0; index < 30; index += 1) {
      clips[0].currentTime = 0.2;
      await player.play();
      expect(clips[0].currentTime).toBe(0);
      player.cancel();
      expect(clips[0].paused).toBe(true);
    }
    expect(constructor).toHaveBeenCalledOnce();
    expect(clips[0].play).toHaveBeenCalledTimes(30);
    expect(clips[0].load).not.toHaveBeenCalled();
    expect(clips[0].removeAttribute).not.toHaveBeenCalled();
  });

  it('stops the previous cue before restarting at the beginning', async () => {
    const player = open();
    await player.play();
    clips[0].currentTime = 0.1;
    const playing = player.play();
    expect(clips[0].pause).toHaveBeenCalledTimes(2);
    expect(clips[0].currentTime).toBe(0);
    expect(clips[0].pause.mock.invocationCallOrder[1]).toBeLessThan(clips[0].play.mock.invocationCallOrder[1]);
    await playing;
  });

  describe.each(['cancel', 'dispose'] as const)('during pending playback: %s', (action) => {
    it.each(['resolve', 'reject'] as const)('stops playback and ignores late %s without replay', async (result) => {
      const player = open();
      const playback = deferred();
      clips[0].play.mockReturnValueOnce(playback.promise);
      const playing = player.play();
      player[action]();
      const pauses = clips[0].pause.mock.calls.length;
      expect(clips[0].paused).toBe(true);
      if (result === 'resolve') playback.resolve();
      else playback.reject(new Error('Aborted'));
      await playing;
      expect(clips[0].play).toHaveBeenCalledOnce();
      expect(clips[0].pause).toHaveBeenCalledTimes(pauses);
      expect(clips[0].removeAttribute).toHaveBeenCalledTimes(action === 'dispose' ? 1 : 0);
    });
  });

  it.each(['resolve', 'reject'] as const)('ignores stale playback %s while a newer cue is active', async (result) => {
    const player = open();
    const playback = deferred();
    clips[0].play.mockReturnValueOnce(playback.promise);
    const previous = player.play();
    await player.play();
    const pauses = clips[0].pause.mock.calls.length;
    if (result === 'resolve') playback.resolve();
    else playback.reject(new Error('Old playback'));
    await previous;
    expect(constructor).toHaveBeenCalledOnce();
    expect(clips[0].play).toHaveBeenCalledTimes(2);
    expect(clips[0].pause).toHaveBeenCalledTimes(pauses);
    expect(clips[0].paused).toBe(false);
  });

  it.each(['throw', 'reject', 'seek'] as const)('handles %s safely and retries only on a new action', async (failure) => {
    const player = open();
    if (failure === 'throw') clips[0].play.mockImplementationOnce(() => { throw new Error('Blocked'); });
    else if (failure === 'reject') clips[0].play.mockRejectedValueOnce(new Error('Blocked'));
    else {
      clips[0].currentTime = 0.1;
      vi.spyOn(clips[0], 'currentTime', 'set').mockImplementationOnce(() => { throw new Error('Unavailable'); });
    }
    await expect(player.play()).resolves.toBeUndefined();
    expect(clips[0].paused).toBe(true);
    const played = clips[0].play.mock.calls.length;
    await Promise.resolve();
    expect(clips[0].play).toHaveBeenCalledTimes(played);
    await player.play();
    expect(clips[0].play).toHaveBeenCalledTimes(played + 1);
    expect(clips[0].paused).toBe(false);
  });

  it.each(['error', 'pause', 'completion'] as const)('keeps the clip loaded after native %s and waits for a new action', async (event) => {
    const player = open();
    await player.play();
    clips[0].paused = true;
    clips[0].currentTime = 0.2;
    if (event === 'error') clips[0].error = { code: 3 };
    expect(clips[0].play).toHaveBeenCalledOnce();
    expect(clips[0].load).not.toHaveBeenCalled();
    expect(clips[0].removeAttribute).not.toHaveBeenCalled();
    await player.play();
    expect(clips[0].play).toHaveBeenCalledTimes(2);
    expect(clips[0].currentTime).toBe(0);
    expect(clips[0].load).toHaveBeenCalledTimes(event === 'error' ? 1 : 0);
  });

  it.each(['visibilitychange', 'pagehide'])('cancels pending playback on %s and never replays on return', async (event) => {
    const player = open();
    const playback = deferred();
    clips[0].play.mockReturnValueOnce(playback.promise);
    const playing = player.play();
    if (event === 'visibilitychange') {
      documentTarget.hidden = true;
      documentTarget.dispatchEvent(new Event(event));
    } else windowTarget.dispatchEvent(new Event(event));
    expect(clips[0].paused).toBe(true);
    documentTarget.hidden = false;
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    playback.resolve();
    await playing;
    expect(clips[0].play).toHaveBeenCalledOnce();
    expect(clips[0].removeAttribute).not.toHaveBeenCalled();
    await player.play();
    expect(clips[0].play).toHaveBeenCalledTimes(2);
  });

  it.each(['hidden', 'disposed'] as const)('does not start cues while %s', async (state) => {
    const player = open();
    if (state === 'hidden') documentTarget.hidden = true;
    else player.dispose();
    await player.play();
    expect(constructor).toHaveBeenCalledOnce();
    expect(clips[0].play).not.toHaveBeenCalled();
  });

  it.each(['missing', 'throwing'] as const)('keeps navigation safe if Audio is %s and retries only on a new action', async (failure) => {
    if (failure === 'missing') vi.stubGlobal('Audio', undefined);
    else constructor.mockImplementation(() => { throw new Error('Unavailable'); });
    const player = open();
    await expect(player.play()).resolves.toBeUndefined();
    expect(clips).toHaveLength(0);
    constructor.mockImplementation(function (src: string) {
      const clip = mockAudio(src);
      clips.push(clip);
      return clip;
    });
    vi.stubGlobal('Audio', constructor);
    await player.play();
    expect(clips[0].play).toHaveBeenCalledOnce();
  });

  it.each(['pause', 'removeAttribute', 'load'] as const)('removes all listeners even when cleanup %s throws', async (operation) => {
    const player = open();
    await player.play();
    clips[0][operation].mockImplementationOnce(() => { throw new Error('Unavailable'); });
    const removeDocument = vi.spyOn(documentTarget, 'removeEventListener');
    const removeWindow = vi.spyOn(windowTarget, 'removeEventListener');
    expect(() => player.dispose()).not.toThrow();
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(removeWindow).toHaveBeenCalledWith('pagehide', expect.any(Function));
    await player.play();
    expect(clips[0].play).toHaveBeenCalledOnce();
  });

  it('releases unused preloads and owns independent resources through Strict Mode setup-cleanup-setup', async () => {
    const player = open();
    player.dispose();
    player.dispose();
    expect(clips[0].pause).toHaveBeenCalledOnce();
    expect(clips[0].removeAttribute).toHaveBeenCalledExactlyOnceWith('src');
    expect(clips[0].load).toHaveBeenCalledOnce();
    const next = open();
    await next.play();
    const previousPauses = clips[0].pause.mock.calls.length;
    windowTarget.dispatchEvent(new Event('pagehide'));
    expect(clips[0].pause).toHaveBeenCalledTimes(previousPauses);
    expect(clips[1].paused).toBe(true);
    next.dispose();
    expect(clips[1].removeAttribute).toHaveBeenCalledExactlyOnceWith('src');
    expect(constructor).toHaveBeenCalledTimes(2);
  });
});