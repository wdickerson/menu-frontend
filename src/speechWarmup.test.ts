import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installSpeechWarmup } from './speechWarmup';

const INTERACTIONS = ['pointerup', 'touchend', 'keyup', 'click'];

function mockSynthesis() {
  return { speaking: false, pending: false,
    speak: vi.fn<(utterance: SpeechSynthesisUtterance) => void>(), cancel: vi.fn() };
}

function start(utterance: SpeechSynthesisUtterance) {
  utterance.onstart?.call(utterance, new Event('start') as SpeechSynthesisEvent);
}

function reject(utterance: SpeechSynthesisUtterance) {
  utterance.onerror?.call(utterance, new Event('error') as SpeechSynthesisErrorEvent);
}

describe('silent speech warm-up', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      volume = 1;
      voice = null;
      lang = '';
      constructor(public text: string) {}
    });
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('attempts silent speech on page load and stops listening once speech starts', () => {
    const target = new EventTarget();
    const synthesis = mockSynthesis();
    const cleanup = installSpeechWarmup(target, synthesis as unknown as SpeechSynthesis);
    expect(synthesis.speak).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(synthesis.speak).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      text: 'ready', volume: 0, voice: null, lang: '',
    }));
    start(synthesis.speak.mock.calls[0][0]);
    for (const event of INTERACTIONS) target.dispatchEvent(new Event(event));
    expect(synthesis.speak).toHaveBeenCalledOnce();
    expect(synthesis.cancel).not.toHaveBeenCalled();
    cleanup();
  });

  it.each(INTERACTIONS)('retries a rejected page-load attempt on %s', (event) => {
    const target = new EventTarget();
    const synthesis = mockSynthesis();
    const cleanup = installSpeechWarmup(target, synthesis as unknown as SpeechSynthesis);
    vi.runAllTimers();
    reject(synthesis.speak.mock.calls[0][0]);
    target.dispatchEvent(new Event(event));
    expect(synthesis.speak).toHaveBeenCalledTimes(2);
    expect(synthesis.speak).toHaveBeenLastCalledWith(expect.objectContaining({
      text: 'ready', volume: 0, voice: null, lang: '',
    }));
    expect(synthesis.cancel).not.toHaveBeenCalled();
    start(synthesis.speak.mock.calls[1][0]);
    for (const nextEvent of INTERACTIONS) {
      target.dispatchEvent(new Event(nextEvent));
    }
    expect(synthesis.speak).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it('replaces a stalled startup request on click, ignoring late callbacks from the old request', () => {
    const target = new EventTarget();
    const synthesis = mockSynthesis();
    const cleanup = installSpeechWarmup(target, synthesis as unknown as SpeechSynthesis);
    vi.runAllTimers();
    const oldUtterance = synthesis.speak.mock.calls[0][0];
    synthesis.pending = true;
    synthesis.cancel.mockImplementation(() => { synthesis.pending = false; });
    target.dispatchEvent(new Event('pointerup'));
    expect(synthesis.speak).toHaveBeenCalledOnce();
    target.dispatchEvent(new Event('click'));
    expect(synthesis.cancel).toHaveBeenCalledOnce();
    expect(synthesis.speak).toHaveBeenCalledTimes(2);
    start(oldUtterance);
    reject(oldUtterance);
    for (const event of INTERACTIONS) target.dispatchEvent(new Event(event));
    expect(synthesis.speak).toHaveBeenCalledTimes(2);
    start(synthesis.speak.mock.calls[1][0]);
    cleanup();
  });

  it('does not replace startup speech that is already speaking before its start callback', () => {
    const target = new EventTarget();
    const synthesis = mockSynthesis();
    const cleanup = installSpeechWarmup(target, synthesis as unknown as SpeechSynthesis);
    vi.runAllTimers();
    synthesis.speaking = true;
    target.dispatchEvent(new Event('click'));
    expect(synthesis.cancel).not.toHaveBeenCalled();
    expect(synthesis.speak).toHaveBeenCalledOnce();
    cleanup();
  });

  it('does not queue duplicate warm-ups when one interaction generates several events', () => {
    const target = new EventTarget();
    const synthesis = mockSynthesis();
    const cleanup = installSpeechWarmup(target, synthesis as unknown as SpeechSynthesis);
    for (const event of INTERACTIONS) target.dispatchEvent(new Event(event));
    vi.runAllTimers();
    expect(synthesis.speak).toHaveBeenCalledOnce();
    expect(synthesis.cancel).not.toHaveBeenCalled();
    cleanup();
  });

  it('removes all listeners on cleanup, including Strict Mode setup-cleanup-setup', () => {
    const target = new EventTarget();
    const synthesis = mockSynthesis();
    const firstCleanup = installSpeechWarmup(target, synthesis as unknown as SpeechSynthesis);
    firstCleanup();
    vi.runAllTimers();
    for (const event of INTERACTIONS) target.dispatchEvent(new Event(event));
    expect(synthesis.speak).not.toHaveBeenCalled();
    const secondCleanup = installSpeechWarmup(target, synthesis as unknown as SpeechSynthesis);
    vi.runAllTimers();
    expect(synthesis.speak).toHaveBeenCalledOnce();
    secondCleanup();
    reject(synthesis.speak.mock.calls[0][0]);
    for (const event of INTERACTIONS) target.dispatchEvent(new Event(event));
    expect(synthesis.speak).toHaveBeenCalledOnce();
  });

  it.each(['speaking', 'pending'] as const)('does not interfere with %s speech and retries later', (state) => {
    const target = new EventTarget();
    const synthesis = mockSynthesis();
    synthesis[state] = true;
    const cleanup = installSpeechWarmup(target, synthesis as unknown as SpeechSynthesis);
    vi.runAllTimers();
    target.dispatchEvent(new Event('click'));
    expect(synthesis.speak).not.toHaveBeenCalled();
    expect(synthesis.cancel).not.toHaveBeenCalled();
    synthesis[state] = false;
    target.dispatchEvent(new Event('click'));
    expect(synthesis.speak).toHaveBeenCalledOnce();
    cleanup();
  });

  it('does not break interactions if speech is blocked and retries the next interaction', () => {
    const target = new EventTarget();
    const synthesis = mockSynthesis();
    synthesis.speak.mockImplementationOnce(() => { throw new Error('Blocked'); });
    const cleanup = installSpeechWarmup(target, synthesis as unknown as SpeechSynthesis);
    expect(() => vi.runAllTimers()).not.toThrow();
    target.dispatchEvent(new Event('click'));
    expect(synthesis.speak).toHaveBeenCalledTimes(2);
    target.dispatchEvent(new Event('click'));
    expect(synthesis.speak).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it('safely handles unsupported speech APIs', () => {
    const target = new EventTarget();
    expect(() => installSpeechWarmup(target, undefined)()).not.toThrow();
    vi.stubGlobal('SpeechSynthesisUtterance', undefined);
    const synthesis = mockSynthesis();
    const cleanup = installSpeechWarmup(target, synthesis as unknown as SpeechSynthesis);
    vi.runAllTimers();
    target.dispatchEvent(new Event('click'));
    expect(synthesis.speak).not.toHaveBeenCalled();
    cleanup();
  });
});