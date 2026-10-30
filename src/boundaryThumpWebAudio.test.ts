import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoundaryThump } from './boundaryThump';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function mockContext() {
  const decoded = { duration: 0.2, length: 9600 };
  const sources: Array<ReturnType<typeof makeSource>> = [];
  function makeSource() {
    return {
      buffer: null as object | null,
      loop: false,
      onended: null as (() => void) | null,
      connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
    };
  }
  const context = {
    state: 'running' as AudioContextState,
    sampleRate: 48000,
    destination: {}, decoded, sources,
    createBuffer: vi.fn((_channels: number, length: number, _rate: number) => {
      const samples = new Float32Array(length);
      return { length, getChannelData: vi.fn(() => samples) };
    }),
    createBufferSource: vi.fn(() => {
      const source = makeSource();
      sources.push(source);
      return source;
    }),
    decodeAudioData: vi.fn(async (_data: ArrayBuffer) => decoded),
    resume: vi.fn(async () => { context.state = 'running'; }),
    close: vi.fn(async () => { context.state = 'closed'; }),
  };
  return context;
}

describe('decoded Web Audio boundary thump', () => {
  let context: ReturnType<typeof mockContext>;
  let constructor: ReturnType<typeof vi.fn>;
  let fetcher: ReturnType<typeof vi.fn>;
  let response: { ok: boolean; arrayBuffer: ReturnType<typeof vi.fn> };
  let media: { preload: string; currentTime: number; error: null;
    play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>; removeAttribute: ReturnType<typeof vi.fn> };
  let mediaConstructor: ReturnType<typeof vi.fn>;
  let documentTarget: EventTarget & { hidden: boolean };
  let windowTarget: EventTarget & { AudioContext?: unknown };
  let session: { type: string };
  let thump: ReturnType<typeof createBoundaryThump> | null;
  const wav = new ArrayBuffer(32);

  function open() {
    thump = createBoundaryThump();
    return thump;
  }

  async function ready() {
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledOnce());
  }

  beforeEach(() => {
    thump = null;
    context = mockContext();
    constructor = vi.fn(function () { return context; });
    response = { ok: true, arrayBuffer: vi.fn().mockResolvedValue(wav) };
    fetcher = vi.fn().mockResolvedValue(response);
    media = {
      preload: '', currentTime: 0, error: null,
      play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(),
      load: vi.fn(), removeAttribute: vi.fn(),
    };
    mediaConstructor = vi.fn(function () { return media; });
    documentTarget = Object.assign(new EventTarget(), { hidden: false });
    windowTarget = Object.assign(new EventTarget(), { AudioContext: constructor });
    let sessionType = 'ambient';
    session = { get type() { return sessionType; }, set type(value) { sessionType = value; } };
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('Audio', mediaConstructor);
    vi.stubGlobal('document', documentTarget);
    vi.stubGlobal('window', windowTarget);
    vi.stubGlobal('navigator', { audioSession: session });
  });

  afterEach(() => {
    thump?.dispose();
    vi.unstubAllGlobals();
  });

  it('sets supported playback-session intent before context creation and restores it on exit', async () => {
    const setter = vi.spyOn(session, 'type', 'set');
    const initializationSessions: string[] = [];
    constructor.mockImplementationOnce(function () {
      initializationSessions.push(session.type);
      return context;
    });
    const player = open();
    expect(initializationSessions).toEqual(['playback']);
    expect(setter.mock.invocationCallOrder[0]).toBeLessThan(constructor.mock.invocationCallOrder[0]);
    await ready();
    await player.play();
    player.cancel();
    expect(setter).toHaveBeenCalledExactlyOnceWith('playback');
    player.dispose();
    expect(session.type).toBe('ambient');
    expect(setter).toHaveBeenLastCalledWith('ambient');
  });

  it('predecodes the base-safe recording and silently warms the interactive context', async () => {
    const player = open();
    expect(constructor).toHaveBeenCalledExactlyOnceWith({ latencyHint: 'interactive' });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `${import.meta.env.BASE_URL}assets/boundary-thump.wav`, { signal: expect.any(AbortSignal) },
    );
    expect(context.createBuffer).toHaveBeenCalledExactlyOnceWith(1, 1, 48000);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].buffer).toEqual(expect.objectContaining({ length: 1 }));
    expect(context.sources[0].start).toHaveBeenCalledExactlyOnceWith(0);
    await ready();
    expect(context.decodeAudioData).toHaveBeenCalledExactlyOnceWith(wav);
    expect(context.sources).toHaveLength(1); // Decode completion is never playback.
    expect(mediaConstructor).not.toHaveBeenCalled();
    const playing = player.play();
    // Intentionally before await: no fetch, resume promise, or timer delays start.
    expect(context.sources[1].buffer).toBe(context.decoded);
    expect(context.sources[1].connect).toHaveBeenCalledWith(context.destination);
    expect(context.sources[1].start).toHaveBeenCalledExactlyOnceWith(0);
    await playing;
    expect(mediaConstructor).not.toHaveBeenCalled();
  });

  it.each([
    { device: 'iPhone', userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5 },
    { device: 'desktop-mode iPad', userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 },
  ])('uses the louder recording for both decoded cues and pending-decode fallback on $device', async ({ userAgent, platform, maxTouchPoints }) => {
    vi.stubGlobal('navigator', { audioSession: session, userAgent, platform, maxTouchPoints });
    const decode = deferred<typeof context.decoded>();
    context.decodeAudioData.mockReturnValueOnce(decode.promise);
    const player = open();
    const assetUrl = `${import.meta.env.BASE_URL}assets/boundary-thump-ios.wav`;
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(assetUrl, { signal: expect.any(AbortSignal) });
    await ready();
    await player.play();
    expect(mediaConstructor).toHaveBeenCalledExactlyOnceWith(assetUrl);
    expect(media.play).toHaveBeenCalledOnce();
    decode.resolve(context.decoded);
    await decode.promise;
    await Promise.resolve();
    const playing = player.play();
    expect(context.sources[1].buffer).toBe(context.decoded);
    expect(context.sources[1].connect).toHaveBeenCalledWith(context.destination);
    expect(context.sources[1].start).toHaveBeenCalledExactlyOnceWith(0);
    await playing;
    expect(fetcher).toHaveBeenCalledOnce();
    expect(media.play).toHaveBeenCalledOnce();
  });

  it('reuses the decoded buffer/context but makes a fresh source for every cue', async () => {
    const setter = vi.spyOn(session, 'type', 'set');
    const player = open();
    await ready();
    for (let index = 1; index <= 30; index += 1) {
      await player.play();
      expect(context.sources[index].buffer).toBe(context.decoded);
      player.cancel(); // Speech cancels the cue, not the running context.
      expect(context.sources[index].stop).toHaveBeenCalledOnce();
      expect(context.sources[index].disconnect).toHaveBeenCalledOnce();
    }
    expect(constructor).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(context.decodeAudioData).toHaveBeenCalledOnce();
    expect(context.resume).not.toHaveBeenCalled();
    expect(context.close).not.toHaveBeenCalled();
    expect(setter).toHaveBeenCalledExactlyOnceWith('playback');
    player.dispose();
    expect(session.type).toBe('ambient');
  });

  it('warms up once with a silent sample and never runs a continuous output', async () => {
    const player = open();
    await ready();
    const warmup = context.sources[0];
    const samples: Float32Array = context.createBuffer.mock.results[0].value.getChannelData(0);
    expect(Array.from(samples)).toEqual([0]);
    expect(warmup.loop).toBe(false);
    warmup.onended?.();
    expect(warmup.disconnect).toHaveBeenCalledOnce();
    for (let index = 0; index < 4; index += 1) {
      player.cancel();
      documentTarget.dispatchEvent(new Event('touchend'));
      await player.play();
      const cue = context.sources.at(-1)!;
      expect(cue.buffer).toBe(context.decoded);
      expect(cue.loop).toBe(false);
      cue.onended?.();
    }
    expect(context.sources).toHaveLength(5);
    expect(context.createBuffer).toHaveBeenCalledOnce();
    expect(warmup.start).toHaveBeenCalledOnce();
    expect(warmup.stop).not.toHaveBeenCalled();
  });

  it('retries failed startup warmup without breaking cues or leaking nodes', async () => {
    context.createBuffer.mockImplementationOnce(() => { throw new Error('Interrupted'); });
    const player = open();
    await ready();
    expect(context.sources[0].stop).toHaveBeenCalledOnce();
    expect(context.sources[0].disconnect).toHaveBeenCalledOnce();
    documentTarget.dispatchEvent(new Event('touchend'));
    expect(context.sources[1].loop).toBe(false);
    expect(context.sources[1].buffer).toEqual(expect.objectContaining({ length: 1 }));
    await player.play();
    expect(context.sources[2].buffer).toBe(context.decoded);
    expect(context.sources[1].stop).not.toHaveBeenCalled();
  });

  it('disconnects naturally ended sources without an old event canceling a newer cue', async () => {
    const player = open();
    await ready();
    await player.play();
    const oldSource = context.sources[1];
    const oldEnded = oldSource.onended;
    await player.play();
    const current = context.sources[2];
    oldEnded?.();
    expect(current.stop).not.toHaveBeenCalled();
    current.onended?.();
    expect(current.disconnect).toHaveBeenCalledOnce();
    player.cancel();
    expect(current.stop).not.toHaveBeenCalled();
  });

  it('queues a decoded cue synchronously while resume is pending and cancels it before speech', async () => {
    const player = open();
    await ready();
    const resume = deferred();
    context.state = 'suspended';
    context.resume.mockReturnValueOnce(resume.promise);
    const playing = player.play();
    const cue = context.sources[1];
    expect(context.resume).toHaveBeenCalledOnce();
    expect(cue.start).toHaveBeenCalledWith(0);
    player.cancel();
    expect(cue.stop).toHaveBeenCalledOnce();
    resume.resolve();
    await playing;
    expect(cue.start).toHaveBeenCalledOnce();
    expect(context.sources).toHaveLength(2);
  });

  it('stops a blocked cue without automatically replaying it, then retries on another gesture', async () => {
    const player = open();
    await ready();
    context.state = 'suspended';
    context.resume.mockRejectedValueOnce(new Error('NotAllowedError'));
    await expect(player.play()).resolves.toBeUndefined();
    expect(context.sources[1].stop).toHaveBeenCalledOnce();
    expect(context.sources).toHaveLength(2);
    await player.play();
    expect(context.sources[2].start).toHaveBeenCalledOnce();
  });

  it('ignores a stale resume rejection once a newer cue is running', async () => {
    const player = open();
    await ready();
    const resume = deferred();
    context.state = 'suspended';
    context.resume.mockReturnValueOnce(resume.promise);
    const older = player.play();
    context.state = 'running';
    await player.play();
    resume.reject(new Error('Old interruption'));
    await older;
    expect(context.sources[1].stop).toHaveBeenCalledOnce();
    expect(context.sources[2].stop).not.toHaveBeenCalled();
  });

  it('retries blocked entry warmup in a completed gesture without playing the recording', async () => {
    context.state = 'suspended';
    context.resume.mockRejectedValueOnce(new Error('NotAllowedError'));
    open();
    await ready();
    expect(context.resume).toHaveBeenCalledOnce();
    documentTarget.dispatchEvent(new Event('touchend'));
    expect(context.resume).toHaveBeenCalledTimes(2);
    for (const event of ['pointerup', 'keydown', 'keyup', 'click']) {
      documentTarget.dispatchEvent(new Event(event));
    }
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].buffer).not.toBe(context.decoded);
    expect(media.play).not.toHaveBeenCalled();
  });

  it('retries resume inside a gesture even if Safari leaves startup resume pending', async () => {
    const startup = deferred();
    context.state = 'suspended';
    context.resume.mockReturnValueOnce(startup.promise);
    const player = open();
    await ready();
    expect(context.resume).toHaveBeenCalledOnce();
    documentTarget.dispatchEvent(new Event('touchend'));
    expect(context.resume).toHaveBeenCalledTimes(2);
    expect(context.state).toBe('running');
    await player.play();
    expect(context.sources[1].start).toHaveBeenCalledOnce();
    startup.reject(new Error('Stale startup rejection'));
    await Promise.resolve();
    expect(context.sources[1].stop).not.toHaveBeenCalled();
  });

  it('uses media immediately while decoding and never replays that gesture when ready', async () => {
    const decode = deferred<typeof context.decoded>();
    context.decodeAudioData.mockReturnValueOnce(decode.promise);
    const player = open();
    await ready();
    const playing = player.play();
    expect(media.play).toHaveBeenCalledOnce();
    expect(media.preload).toBe('metadata');
    await playing;
    decode.resolve(context.decoded);
    await decode.promise;
    await Promise.resolve();
    expect(context.sources).toHaveLength(1);
    expect(media.play).toHaveBeenCalledOnce();
    await player.play();
    expect(context.sources[1].buffer).toBe(context.decoded);
    expect(media.play).toHaveBeenCalledOnce();
    expect(media.pause).toHaveBeenCalledOnce();
    expect(context.sources[1].stop).not.toHaveBeenCalled();
  });

  it.each(['fetch', 'http', 'body', 'decode', 'constructor'])('falls back safely on %s failure', async (failure) => {
    if (failure === 'fetch') fetcher.mockRejectedValueOnce(new Error('Offline'));
    if (failure === 'http') response.ok = false;
    if (failure === 'body') response.arrayBuffer.mockRejectedValueOnce(new Error('Bad data'));
    if (failure === 'decode') context.decodeAudioData.mockRejectedValueOnce(new Error('Bad audio'));
    if (failure === 'constructor') constructor.mockImplementationOnce(() => { throw new Error('Unavailable'); });
    const player = open();
    if (failure === 'decode') await ready();
    await expect(player.play()).resolves.toBeUndefined();
    expect(media.play).toHaveBeenCalledOnce();
    expect(media.preload).toBe('metadata');
    expect(context.sources.every((cue) => cue.buffer !== context.decoded)).toBe(true);
  });

  it('falls back if a Web Audio source cannot start', async () => {
    const player = open();
    await ready();
    context.createBufferSource.mockImplementationOnce(() => { throw new Error('Unavailable'); });
    await expect(player.play()).resolves.toBeUndefined();
    expect(media.play).toHaveBeenCalledOnce();
  });

  it('uses the media fallback when the standard AudioContext API is unavailable', async () => {
    windowTarget.AudioContext = undefined;
    const player = open();
    const playing = player.play();
    expect(media.play).toHaveBeenCalledOnce();
    expect(media.preload).toBe('metadata');
    expect(constructor).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    await playing;
  });

  it.each(['visibilitychange', 'pagehide'])('stops pending audio on %s and never replays on return', async (event) => {
    const player = open();
    await ready();
    context.state = 'suspended';
    const resume = deferred();
    context.resume.mockReturnValueOnce(resume.promise);
    const playing = player.play();
    if (event === 'visibilitychange') {
      documentTarget.hidden = true;
      documentTarget.dispatchEvent(new Event(event));
    } else windowTarget.dispatchEvent(new Event(event));
    expect(context.sources[1].stop).toHaveBeenCalledOnce();
    expect(context.sources[0].stop).toHaveBeenCalledOnce();
    expect(context.sources[0].disconnect).toHaveBeenCalledOnce();
    documentTarget.hidden = false;
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    resume.resolve();
    await playing;
    expect(context.sources).toHaveLength(2);
    expect(context.sources[1].start).toHaveBeenCalledOnce();
    documentTarget.dispatchEvent(new Event('touchend'));
    expect(context.sources).toHaveLength(2);
  });

  it('does not start a cue or warmup while hidden or disposed', async () => {
    const player = open();
    await ready();
    documentTarget.hidden = true;
    context.state = 'suspended';
    documentTarget.dispatchEvent(new Event('touchend'));
    await player.play();
    expect(context.resume).not.toHaveBeenCalled();
    expect(context.sources).toHaveLength(1);
    player.dispose();
    documentTarget.hidden = false;
    documentTarget.dispatchEvent(new Event('touchend'));
    await player.play();
    expect(context.sources).toHaveLength(1);
    expect(mediaConstructor).not.toHaveBeenCalled();
  });

  it('aborts fetch and ignores a late response after disposal', async () => {
    const network = deferred<typeof response>();
    fetcher.mockReturnValueOnce(network.promise);
    const player = open();
    const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
    player.dispose();
    expect(signal.aborted).toBe(true);
    network.resolve(response);
    await vi.waitFor(() => expect(response.arrayBuffer).toHaveBeenCalledOnce());
    expect(context.decodeAudioData).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('discards late decoding and removes gesture listeners during Strict Mode cleanup', async () => {
    const decode = deferred<typeof context.decoded>();
    context.decodeAudioData.mockReturnValueOnce(decode.promise);
    const remove = vi.spyOn(documentTarget, 'removeEventListener');
    const player = open();
    await ready();
    const firstContext = context;
    player.dispose();
    decode.resolve(firstContext.decoded);
    await decode.promise;
    expect(firstContext.close).toHaveBeenCalledOnce();
    expect(firstContext.sources[0].stop).toHaveBeenCalledOnce();
    for (const event of ['pointerup', 'touchend', 'keydown', 'keyup', 'click']) {
      expect(remove).toHaveBeenCalledWith(event, expect.any(Function), { capture: true });
    }
    expect(session.type).toBe('ambient');
    context = mockContext();
    const next = open();
    await ready();
    await next.play();
    expect(context.sources[1].buffer).toBe(context.decoded);
    expect(firstContext.sources).toHaveLength(1);
  });

  it('restores the session even if context closing rejects', async () => {
    const player = open();
    await ready();
    await player.play();
    context.close.mockRejectedValueOnce(new Error('Interrupted'));
    expect(() => player.dispose()).not.toThrow();
    expect(session.type).toBe('ambient');
    expect(context.sources[1].stop).toHaveBeenCalledOnce();
    expect(context.sources[1].disconnect).toHaveBeenCalledOnce();
  });
});