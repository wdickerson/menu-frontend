import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoundaryThump } from './boundaryThump';

function parameter() {
  return { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
}

function mockContext(initialState = 'running') {
  const oscillators: Array<ReturnType<typeof oscillator>> = [];
  const gains: Array<ReturnType<typeof gain>> = [];
  function oscillator() {
    return { type: '', frequency: parameter(), connect: vi.fn(), disconnect: vi.fn(),
      start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
  }
  function gain() {
    return { gain: parameter(), connect: vi.fn(), disconnect: vi.fn() };
  }
  const context = Object.assign(new EventTarget(), {
    state: initialState, currentTime: 10, destination: {},
    createOscillator: vi.fn(() => { const node = oscillator(); oscillators.push(node); return node; }),
    createGain: vi.fn(() => { const node = gain(); gains.push(node); return node; }),
    resume: vi.fn(async () => { context.state = 'running'; }),
    close: vi.fn(async () => { context.state = 'closed'; }),
  });
  return { context, oscillators, gains };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('boundary thump', () => {
  let audio: ReturnType<typeof mockContext>;
  let constructor: ReturnType<typeof vi.fn>;
  let session: { type: string };
  let thump: ReturnType<typeof createBoundaryThump>;

  beforeEach(() => {
    audio = mockContext();
    constructor = vi.fn(function () { return audio.context; });
    session = { type: 'auto' };
    vi.stubGlobal('window', { AudioContext: constructor });
    vi.stubGlobal('navigator', { audioSession: session });
    thump = createBoundaryThump();
  });
  afterEach(() => {
    thump.dispose();
    vi.unstubAllGlobals();
  });

  it('synthesizes the requested sine sweep and releases nodes on completion', async () => {
    await thump.play();
    const node = audio.oscillators[0];
    expect(node.type).toBe('sine');
    expect(node.frequency.setValueAtTime).toHaveBeenCalledExactlyOnceWith(280, 10);
    expect(node.frequency.exponentialRampToValueAtTime).toHaveBeenCalledExactlyOnceWith(220, 10.16);
    expect(audio.gains[0].gain.setValueAtTime).toHaveBeenCalledExactlyOnceWith(0.0001, 10);
    expect(audio.gains[0].gain.exponentialRampToValueAtTime.mock.calls).toEqual([
      [0.6, 10.012], [0.0001, 10.18],
    ]);
    expect(node.start).toHaveBeenCalledExactlyOnceWith(10);
    expect(node.stop).toHaveBeenCalledExactlyOnceWith(10.2);
    expect(session.type).toBe('playback');
    node.onended?.();
    expect(node.disconnect).toHaveBeenCalledOnce();
    expect(audio.gains[0].disconnect).toHaveBeenCalledOnce();
    expect(session.type).toBe('auto');
  });

  it.each(['suspended', 'interrupted'])('awaits %s recovery, resuming inside the gesture', async (state) => {
    audio.context.state = state;
    const recovery = deferred();
    audio.context.resume.mockReturnValue(recovery.promise);
    const playing = thump.play();
    expect(audio.context.resume).toHaveBeenCalledOnce();
    expect(audio.context.createOscillator).not.toHaveBeenCalled();
    audio.context.state = 'running';
    recovery.resolve();
    await playing;
    expect(audio.context.createOscillator).toHaveBeenCalledOnce();
  });

  it.each(['cancel', 'dispose'] as const)('does not play after delayed recovery and %s', async (action) => {
    audio.context.state = 'suspended';
    const recovery = deferred();
    audio.context.resume.mockReturnValue(recovery.promise);
    const playing = thump.play();
    thump[action]();
    expect(session.type).toBe('auto');
    audio.context.state = 'running';
    recovery.resolve();
    await playing;
    expect(audio.context.createOscillator).not.toHaveBeenCalled();
  });

  it('supersedes pending recovery without stale playback or session restoration', async () => {
    audio.context.state = 'suspended';
    const recovery = deferred();
    audio.context.resume.mockReturnValueOnce(recovery.promise);
    const oldPlaying = thump.play();
    await thump.play();
    recovery.resolve();
    await oldPlaying;
    expect(audio.context.createOscillator).toHaveBeenCalledOnce();
    expect(session.type).toBe('playback');
  });

  it('ignores an old recovery rejection while a newer thump plays', async () => {
    audio.context.state = 'suspended';
    const recovery = deferred();
    audio.context.resume.mockReturnValueOnce(recovery.promise);
    const oldPlaying = thump.play();
    await thump.play();
    recovery.reject(new Error('Interrupted'));
    await oldPlaying;
    expect(session.type).toBe('playback');
    expect(audio.oscillators[0].disconnect).not.toHaveBeenCalled();
  });

  it('stops an earlier thump and ignores its stale completion', async () => {
    await thump.play();
    const oldEnded = audio.oscillators[0].onended;
    await thump.play();
    expect(audio.oscillators[0].stop).toHaveBeenLastCalledWith();
    expect(audio.oscillators[0].disconnect).toHaveBeenCalledOnce();
    oldEnded?.();
    expect(session.type).toBe('playback');
    thump.cancel();
    expect(audio.oscillators[1].disconnect).toHaveBeenCalledOnce();
    expect(session.type).toBe('auto');
  });

  it.each(['suspended', 'interrupted', 'closed'])('removes scheduled playback when context becomes %s', async (state) => {
    await thump.play();
    audio.context.state = state;
    audio.context.dispatchEvent(new Event('statechange'));
    expect(audio.oscillators[0].stop).toHaveBeenLastCalledWith();
    expect(audio.oscillators[0].disconnect).toHaveBeenCalledOnce();
    expect(session.type).toBe('auto');
  });

  it('recreates a closed context on the next gesture', async () => {
    await thump.play();
    audio.context.state = 'closed';
    const replacement = mockContext();
    constructor.mockImplementationOnce(function () { return replacement.context; });
    await thump.play();
    expect(constructor).toHaveBeenCalledTimes(2);
    expect(audio.context.resume).not.toHaveBeenCalled();
    expect(replacement.context.createOscillator).toHaveBeenCalledOnce();
  });

  it.each(['reject', 'throw', 'still suspended'])('safely skips failed recovery: %s', async (failure) => {
    audio.context.state = 'suspended';
    audio.context.resume.mockImplementationOnce(() => {
      if (failure === 'throw') throw new Error('Blocked');
      return failure === 'reject' ? Promise.reject(new Error('Blocked')) : Promise.resolve();
    });
    await expect(thump.play()).resolves.toBeUndefined();
    expect(audio.context.createOscillator).not.toHaveBeenCalled();
    expect(session.type).toBe('auto');
    await thump.play();
    expect(audio.context.createOscillator).toHaveBeenCalledOnce();
  });

  it('handles unavailable and throwing constructors, including WebKit fallback', async () => {
    vi.stubGlobal('window', {});
    await thump.play();
    expect(session.type).toBe('auto');
    constructor.mockImplementationOnce(() => { throw new Error('Unavailable'); });
    vi.stubGlobal('window', { webkitAudioContext: constructor });
    await thump.play();
    expect(session.type).toBe('auto');
    await thump.play();
    expect(audio.context.createOscillator).toHaveBeenCalledOnce();
  });

  it.each(['createGain', 'start'] as const)('releases partially created nodes on %s failure', async (failure) => {
    if (failure === 'createGain') {
      audio.context.createGain.mockImplementationOnce(() => { throw new Error('Closed'); });
    } else {
      audio.context.createOscillator.mockImplementationOnce(() => {
        const node = { type: '', frequency: parameter(), connect: vi.fn(), disconnect: vi.fn(),
          start: vi.fn(() => { throw new Error('Closed'); }), stop: vi.fn(), onended: null };
        audio.oscillators.push(node);
        return node;
      });
    }
    await expect(thump.play()).resolves.toBeUndefined();
    expect(audio.oscillators[0].disconnect).toHaveBeenCalledOnce();
    if (failure === 'start') expect(audio.gains[0].disconnect).toHaveBeenCalledOnce();
    expect(session.type).toBe('auto');
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
    expect(audio.oscillators[0].start).toHaveBeenCalledOnce();
    expect(() => thump.dispose()).not.toThrow();
  });

  it.each(['reject', 'throw'])('restores the exact session value despite close %s', async (failure) => {
    session.type = 'ambient';
    await thump.play();
    audio.context.close.mockImplementationOnce(() => {
      if (failure === 'throw') throw new Error('Closed');
      return Promise.reject(new Error('Closed'));
    });
    expect(() => thump.dispose()).not.toThrow();
    await Promise.resolve();
    expect(session.type).toBe('ambient');
    await thump.play();
    expect(constructor).toHaveBeenCalledOnce();
    expect(audio.context.createOscillator).toHaveBeenCalledOnce();
  });

  it('supports Strict Mode setup-cleanup-setup with independent owners', async () => {
    thump.dispose();
    expect(constructor).not.toHaveBeenCalled();
    thump = createBoundaryThump();
    await thump.play();
    thump.dispose();
    expect(audio.context.close).toHaveBeenCalledOnce();
    expect(session.type).toBe('auto');
  });
});