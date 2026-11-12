// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const audio = vi.hoisted(() => ({ play: vi.fn(), cancel: vi.fn(), dispose: vi.fn() }));
vi.mock('./boundaryThump', () => ({ createBoundaryThump: () => audio }));

describe('App and Quick Nav speech ownership', () => {
  let container: HTMLDivElement;
  let root: Root;
  let queued: SpeechSynthesisUtterance[];
  const speech = {
    speak: vi.fn<(utterance: SpeechSynthesisUtterance) => void>(),
    cancel: vi.fn<() => void>(), speaking: false, pending: false,
  };

  function mount(strict = false) {
    act(() => root.render(strict ? <StrictMode><App /></StrictMode> : <App />));
  }
  function advance(ms = 0) { act(() => vi.advanceTimersByTime(ms)); }
  function button(text: string) {
    return [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === text)!;
  }
  function enter() { act(() => button('Enter Quick Nav Mode').click()); }
  function area() { return container.querySelector<HTMLElement>('.gesture-area')!; }
  function key(value: string) {
    act(() => area().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })));
  }
  function clickArea() {
    act(() => area().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
  }
  function touch(type: string) {
    const point = { clientX: 100, clientY: 100 };
    const event = new Event(type, { bubbles: true });
    Object.defineProperties(event, {
      touches: { value: type === 'touchstart' ? [point] : [] },
      changedTouches: { value: [point] },
    });
    act(() => area().dispatchEvent(event));
  }
  function signal(utterance: SpeechSynthesisUtterance, callback: 'onstart' | 'onend' | 'onerror') {
    if (callback === 'onerror') utterance.onerror?.call(utterance, new Event('error') as SpeechSynthesisErrorEvent);
    else utterance[callback]?.call(utterance, new Event(callback.slice(2)) as SpeechSynthesisEvent);
  }
  function rejectCurrentWarmup() {
    speech.pending = false;
    speech.speaking = false;
    signal(speech.speak.mock.calls.at(-1)![0], 'onerror');
  }
  function utterances() { return speech.speak.mock.calls.map(([utterance]) => utterance); }
  function said() { return utterances().filter((utterance) => utterance.volume !== 0).map((utterance) => utterance.text); }
  function fallbackEvents() {
    for (const type of ['pointerup', 'touchend', 'keyup']) {
      act(() => area().dispatchEvent(new Event(type, { bubbles: true })));
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    queued = [];
    speech.pending = false;
    speech.speaking = false;
    speech.speak.mockImplementation((utterance) => { queued.push(utterance); speech.pending = true; });
    // Native cancellation callbacks may be delayed or absent.
    speech.cancel.mockImplementation(() => { queued = []; speech.pending = false; speech.speaking = false; });
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      rate = 1;
      volume = 1;
      constructor(public text: string) {}
    });
    vi.stubGlobal('speechSynthesis', speech);
    window.localStorage.clear();
    window.localStorage.setItem('menu-reader.menuLibrary', JSON.stringify({
      selectedId: 'captured-ownership',
      recentMenus: [{ id: 'captured-ownership', capturedAt: '2026-11-12T12:00:00Z', menu: {
        restaurantName: 'Test Cafe', sections: [{ name: 'Starters', items: ['Soup', 'Salad'] }],
      } }],
    }));
    window.history.replaceState(null, '', '/');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([false, true])('keeps cold startup activation and retries until Quick Nav owns audio (Strict Mode: %s)', (strict) => {
    mount(strict);
    expect(speech.speak).not.toHaveBeenCalled();
    enter(); // Captured click still warms a cold page before Quick Nav mounts.
    expect(utterances()).toEqual([expect.objectContaining({ text: 'ready', volume: 0 })]);
    advance();
    expect(speech.speak).toHaveBeenCalledOnce();
    rejectCurrentWarmup();
    act(() => area().dispatchEvent(new Event('pointerup', { bubbles: true })));
    expect(speech.speak).toHaveBeenCalledTimes(2);
    expect(speech.cancel).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not let a stale startup click cancel newer queued menu speech (Strict Mode: %s)', (strict) => {
    mount(strict); advance();
    const startup = utterances()[0];
    // Native playback starts before its onstart callback is delivered.
    speech.pending = false;
    speech.speaking = true;
    enter();
    expect(speech.speak).toHaveBeenCalledOnce();
    key('ArrowRight');
    expect(queued.map((utterance) => utterance.text)).toEqual(['Soup']);
    expect(speech.cancel).toHaveBeenCalledOnce();
    clickArea();
    expect(speech.cancel).toHaveBeenCalledOnce();
    expect(said()).toEqual(['Soup']);
    signal(startup, 'onerror'); signal(startup, 'onstart');
    fallbackEvents();
    advance(299);
    expect(said()).toEqual(['Soup']);
    advance(1);
    expect(said()).toEqual(['Soup', 'Soup']);
    expect(utterances().filter((utterance) => utterance.volume === 0)).toHaveLength(1);
    expect(speech.cancel).toHaveBeenCalledTimes(2);
  });

  it('retires startup fallback listeners before the accepted idle finger-down warmup', () => {
    mount(); enter();
    rejectCurrentWarmup();
    const previous = utterances()[0];
    touch('touchstart');
    expect(utterances()).toHaveLength(2);
    expect(utterances()[1]).toMatchObject({ text: 'ready', volume: 0, rate: 1.5 });
    speech.pending = false; // Native flags can lag the newly submitted warmup.
    signal(previous, 'onerror');
    touch('touchcancel');
    fallbackEvents();
    expect(speech.speak).toHaveBeenCalledTimes(2);
    expect(speech.cancel).not.toHaveBeenCalled();
  });

  it('retires startup retries for a boundary even when no menu speech has been submitted', () => {
    mount(); enter();
    const startup = utterances()[0];
    key('ArrowLeft');
    expect(audio.play).toHaveBeenCalledOnce();
    expect(speech.cancel).toHaveBeenCalledOnce();
    signal(startup, 'onerror');
    fallbackEvents();
    expect(speech.speak).toHaveBeenCalledOnce();
    expect(said()).toEqual([]);
  });

  it('retires startup listeners before native cancel can deliver an error callback', () => {
    mount(); enter();
    const startup = utterances()[0];
    const removed = vi.spyOn(document, 'removeEventListener');
    speech.cancel.mockImplementationOnce(() => {
      expect(removed).toHaveBeenCalledWith('click', expect.any(Function), { capture: true });
      queued = [];
      speech.pending = false;
      speech.speaking = false;
      signal(startup, 'onerror');
    });
    key('ArrowRight');
    fallbackEvents();
    expect(said()).toEqual(['Soup']);
    expect(utterances()).toHaveLength(2);
  });

  it.each(['onend', 'onerror'] as const)('does not resume old spelling if cancel delivers %s synchronously', (callback) => {
    mount(); enter(); key('ArrowRight');
    clickArea(); advance(300);
    const previous = utterances().at(-1)!;
    speech.cancel.mockImplementationOnce(() => {
      queued = [];
      speech.pending = false;
      speech.speaking = false;
      signal(previous, callback);
    });
    key('ArrowRight');
    expect(said()).toEqual(['Soup', 'Soup', 'Salad']);
    expect(queued.map((utterance) => utterance.text)).toEqual(['Salad']);
    clickArea(); advance(300);
    expect(said()).toEqual(['Soup', 'Soup', 'Salad', 'Salad']);
  });

  it('does not resubmit app startup speech on exit/reentry and still warms the next idle touch', async () => {
    mount(); enter();
    key('ArrowRight');
    const count = utterances().length;
    await act(async () => {
      button('Exit Quick Nav Mode').click();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(container.querySelector('.gesture-area')).toBeNull();
    enter();
    expect(utterances()).toHaveLength(count);
    expect(area().textContent).toContain('This is the Quick Nav page.');
    touch('touchstart');
    expect(utterances()).toHaveLength(count + 1);
    expect(utterances().at(-1)).toMatchObject({ text: 'ready', volume: 0, rate: 1.5 });
  });
});