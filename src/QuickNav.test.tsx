// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickNav } from './App';
import type { RestaurantMenu } from './data/menus';

const audio = vi.hoisted(() => ({ play: vi.fn(), cancel: vi.fn(), dispose: vi.fn() }));
vi.mock('./boundaryThump', () => ({ createBoundaryThump: () => audio }));

const menu: RestaurantMenu = {
  restaurantName: 'Test Menu',
  sections: [
    { name: 'Starters', items: ['Soup', 'Salad'] },
    { name: 'Mains', items: ['Pasta'] },
    { name: '', items: [] },
  ],
};

describe('Quick Nav input and spoken text', () => {
  let container: HTMLDivElement;
  let root: Root;
  const speech = {
    speak: vi.fn<(utterance: SpeechSynthesisUtterance) => void>(),
    cancel: vi.fn(), speaking: false, pending: false,
  };
  const onSpeechRateChange = vi.fn();
  const onExit = vi.fn();

  function render(value = menu) {
    act(() => root.render(<QuickNav menu={value} speechRate={1.5}
      onSpeechRateChange={onSpeechRateChange} onExit={onExit} />));
  }

  function area() { return container.querySelector<HTMLElement>('.gesture-area')!; }
  function text() { return container.querySelector('p')!.textContent; }
  function utterances() { return speech.speak.mock.calls.map(([utterance]) => utterance); }
  function warmups() { return utterances().filter((utterance) => utterance.volume === 0); }
  // Navigation assertions concern audible speech; silent warm-ups are checked separately.
  function said() { return utterances().filter((utterance) => utterance.volume !== 0).map((utterance) => utterance.text); }
  function complete(utterance: SpeechSynthesisUtterance, callback: 'onend' | 'onerror' = 'onend') {
    if (callback === 'onend') {
      utterance.onend?.call(utterance, new Event('end') as SpeechSynthesisEvent);
    } else {
      utterance.onerror?.call(utterance, new Event('error') as SpeechSynthesisErrorEvent);
    }
  }
  function advance(ms = 700) { act(() => vi.advanceTimersByTime(ms)); }
  function key(value: string, options: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
    act(() => area().dispatchEvent(event));
    return event;
  }
  function click(detail = 1) {
    act(() => area().dispatchEvent(new MouseEvent('click', { bubbles: true, detail })));
  }
  function doubleClick() {
    click(1);
    advance(250); // A native double-click may be slower than the touch window.
    click(2);
    act(() => area().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 })));
  }
  function touch(type: string, x: number, y: number, count = 1, target: HTMLElement = area()) {
    const points = Array.from({ length: count }, () => ({ clientX: x, clientY: y }));
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : points },
      changedTouches: { value: points },
    });
    act(() => target.dispatchEvent(event));
  }
  function tap() { touch('touchstart', 100, 100); touch('touchend', 100, 100); }
  function flick(x: number, y: number) {
    touch('touchstart', 100, 100);
    touch('touchmove', 100 + x, 100 + y);
    touch('touchend', 100 + x, 100 + y);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    speech.speaking = false;
    speech.pending = false;
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      text: string;
      rate = 1;
      volume = 1;
      constructor(value: string) { this.text = value; }
    });
    vi.stubGlobal('speechSynthesis', speech);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    render();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts with instructions and focuses the gesture area', () => {
    expect(text()).toContain('This is the Quick Nav page.');
    expect(document.activeElement).toBe(area());
    expect(said()).toEqual([]);
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it('silently warms idle speech on finger-down before navigating or changing the display', () => {
    const instructions = text();
    touch('touchstart', 100, 100);
    expect(utterances()).toEqual([expect.objectContaining({ text: 'ready', volume: 0, rate: 1.5 })]);
    expect(speech.cancel).not.toHaveBeenCalled();
    expect(audio.cancel).not.toHaveBeenCalled();
    expect(audio.play).not.toHaveBeenCalled();
    expect(text()).toBe(instructions);
    touch('touchmove', 180, 100);
    expect(said()).toEqual([]);
    touch('touchend', 180, 100);
    // No timers or warm-up completion: real speech replaces the warm-up immediately.
    expect(said()).toEqual(['Soup']);
    expect(utterances()[1].volume).toBe(1);
    expect(speech.cancel).toHaveBeenCalledOnce();
    expect(speech.speak.mock.invocationCallOrder[0]).toBeLessThan(speech.cancel.mock.invocationCallOrder[0]);
    expect(speech.cancel.mock.invocationCallOrder[0]).toBeLessThan(speech.speak.mock.invocationCallOrder[1]);
  });

  it('does not queue duplicate warm-ups or periodically speak while idle', () => {
    touch('touchstart', 100, 100);
    touch('touchcancel', 100, 100);
    advance(5000);
    touch('touchstart', 100, 100);
    expect(speech.speak).toHaveBeenCalledOnce();
    complete(warmups()[0]);
    advance(5000);
    expect(speech.speak).toHaveBeenCalledOnce();
    expect(audio.play).not.toHaveBeenCalled();
  });

  it.each(['speaking', 'pending'] as const)('does not warm up while the native speech service is %s', (state) => {
    speech[state] = true;
    touch('touchstart', 100, 100);
    expect(speech.speak).not.toHaveBeenCalled();
    expect(speech.cancel).not.toHaveBeenCalled();
    touch('touchcancel', 100, 100);
    speech[state] = false;
    touch('touchstart', 100, 100);
    expect(warmups()).toHaveLength(1);
  });

  it('does not interrupt an owned menu utterance even before native speech starts', () => {
    key('ArrowRight');
    touch('touchstart', 100, 100);
    expect(speech.speak).toHaveBeenCalledOnce();
    expect(warmups()).toHaveLength(0);
    expect(speech.cancel).toHaveBeenCalledOnce();
    touch('touchend', 180, 100);
    expect(said()).toEqual(['Soup', 'Salad']);
  });

  it('does not warm up for multi-finger input or touches on Exit', () => {
    touch('touchstart', 100, 100, 2);
    touch('touchend', 100, 100);
    const exit = container.querySelector<HTMLButtonElement>('button')!;
    touch('touchstart', 100, 100, 1, exit);
    touch('touchend', 100, 100, 1, exit);
    advance();
    expect(speech.speak).not.toHaveBeenCalled();
    expect(audio.play).not.toHaveBeenCalled();
  });

  it('does not add silent speech to mouse or keyboard input', () => {
    click(); advance();
    key('ArrowRight');
    expect(said()).toEqual(['S', 'Soup']);
    expect(warmups()).toHaveLength(0);
    expect(speech.speak).toHaveBeenCalledTimes(2);
  });

  it.each(['onend', 'onerror'] as const)('allows another warm-up after %s and ignores stale callbacks', (callback) => {
    touch('touchstart', 100, 100);
    const first = warmups()[0];
    complete(first, callback);
    touch('touchcancel', 100, 100);
    touch('touchstart', 100, 100);
    expect(warmups()).toHaveLength(2);
    complete(first, 'onend');
    complete(first, 'onerror');
    touch('touchcancel', 100, 100);
    touch('touchstart', 100, 100);
    expect(warmups()).toHaveLength(2);
    expect(speech.cancel).not.toHaveBeenCalled();
  });

  it('ignores canceled warm-up callbacks without losing ownership of current menu speech', () => {
    flick(80, 0);
    const warmup = warmups()[0];
    complete(warmup, 'onend');
    complete(warmup, 'onerror');
    tap(); advance();
    expect(said()).toEqual(['Soup']); // Stop, not spell: menu speech is still owned.
    tap(); advance();
    expect(said()).toEqual(['Soup', 'S']);
  });

  it('spells on the first idle tap even if the silent warm-up is still speaking', () => {
    tap();
    speech.speaking = true;
    advance(199);
    expect(said()).toEqual([]);
    advance(1);
    expect(said()).toEqual(['S']);
    expect(warmups()).toHaveLength(1);
    expect(speech.cancel).toHaveBeenCalledOnce();
    expect(text()).toBe('Starters');
  });

  it('retries a failed warm-up on the next finger-down without changing navigation', () => {
    speech.speak.mockImplementationOnce(() => { throw new Error('Unavailable'); });
    expect(() => touch('touchstart', 100, 100)).not.toThrow();
    touch('touchcancel', 100, 100);
    flick(80, 0);
    expect(warmups()).toHaveLength(2);
    expect(said()).toEqual(['Soup']);
  });

  it.each(['speechSynthesis', 'SpeechSynthesisUtterance'])('keeps touch navigation usable without %s', (api) => {
    vi.stubGlobal(api, undefined);
    expect(() => flick(80, 0)).not.toThrow();
    expect(text()).toBe('Soup');
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it('uses the current reading speed for the finger-down warm-up', () => {
    doubleClick();
    complete(utterances().at(-1)!);
    touch('touchstart', 100, 100);
    expect(warmups()[0].rate).toBe(1.75);
    expect(warmups()[0].volume).toBe(0);
  });

  it('rewarms before each idle boundary flick and cancels before playing the cue', () => {
    const instructions = text();
    flick(-80, 0);
    advance(3000);
    flick(-80, 0);
    expect(warmups()).toHaveLength(2);
    expect(speech.cancel).toHaveBeenCalledTimes(2);
    expect(audio.play).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 2; index += 1) {
      expect(speech.speak.mock.invocationCallOrder[index]).toBeLessThan(speech.cancel.mock.invocationCallOrder[index]);
      expect(speech.cancel.mock.invocationCallOrder[index]).toBeLessThan(audio.play.mock.invocationCallOrder[index]);
    }
    expect(said()).toEqual([]);
    expect(text()).toBe(instructions);
  });

  it('cancels a warm-up on exit and can warm up again after reentry', () => {
    touch('touchstart', 100, 100);
    const oldWarmup = warmups()[0];
    act(() => root.render(null));
    expect(speech.cancel).toHaveBeenCalledOnce();
    complete(oldWarmup, 'onend');
    complete(oldWarmup, 'onerror');
    advance(5000);
    expect(speech.speak).toHaveBeenCalledOnce();
    render();
    touch('touchstart', 100, 100);
    expect(warmups()).toHaveLength(2);
    expect(text()).toContain('This is the Quick Nav page.');
  });

  it('maps arrows to the same section/item slots and prevents default scrolling', () => {
    for (const arrow of ['ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp']) {
      expect(key(arrow).defaultPrevented).toBe(true);
    }
    expect(said()).toEqual(['Starters', 'Soup', 'Salad', 'Soup', 'Mains', 'Pasta', 'Starters']);
    expect(text()).toBe('Starters');
  });

  it('thumps at boundaries, preserves display, and rereads the endpoint on reversal', () => {
    key('ArrowRight');
    key('ArrowRight');
    key('ArrowRight');
    key('ArrowRight');
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(text()).toBe('Salad');
    key('ArrowLeft');
    key('ArrowLeft');
    expect(said()).toEqual(['Soup', 'Salad', 'Salad', 'Soup']);
  });

  it('retains instructions if the first action is a boundary thump', () => {
    const initial = text();
    key('ArrowUp');
    expect(audio.play).toHaveBeenCalledOnce();
    expect(text()).toBe(initial);
  });

  it('allows blank headings and only thumps for empty-section items in either direction', () => {
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
    expect(text()).toBe('');
    for (const arrow of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowRight']) key(arrow);
    expect(audio.play).toHaveBeenCalledTimes(4);
    expect(text()).toBe('');
    key('ArrowUp');
    expect(text()).toBe('Mains');
  });

  it('does not intercept modified arrows or unrelated keys', () => {
    expect(key('ArrowDown', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key('ArrowDown', { altKey: true }).defaultPrevented).toBe(false);
    expect(key('Enter').defaultPrevented).toBe(false);
    expect(said()).toEqual([]);
  });

  it('single-click spells one character at a time and keeps full menu text displayed', () => {
    click();
    expect(said()).toEqual([]);
    advance();
    expect(said()).toEqual(['S']);
    expect(text()).toBe('Starters');
    click(); advance();
    expect(said()).toEqual(['S', 't']);
  });

  it.each([
    { input: 'touch', delay: 200 },
    { input: 'mouse', delay: 300 },
  ])('reads a character after only $delay ms for $input input', ({ input, delay }) => {
    if (input === 'touch') tap(); else click();
    advance(delay - 1);
    expect(said()).toEqual([]);
    advance(1);
    expect(said()).toEqual(['S']);
  });

  it.each(['touch', 'mouse'])('stops menu speech, then spells on successive %s taps', (input) => {
    const single = () => { if (input === 'touch') tap(); else click(); advance(); };
    key('ArrowRight');
    const cancellations = speech.cancel.mock.calls.length;
    single();
    expect(said()).toEqual(['Soup']);
    expect(speech.cancel).toHaveBeenCalledTimes(cancellations + 1);
    single(); single(); single(); single();
    expect(said()).toEqual(['Soup', 'S', 'o', 'u', 'p']);
    single(); single();
    expect(said()).toEqual(['Soup', 'S', 'o', 'u', 'p']);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(text()).toBe('Soup');
  });

  it.each(['onend', 'onerror'] as const)('starts spelling immediately after speech %s', (callback) => {
    key('ArrowDown');
    complete(utterances().at(-1)!, callback);
    tap(); advance();
    expect(said()).toEqual(['Starters', 'S']);
  });

  it('uses speech state at tap time even if speech finishes during recognition', () => {
    key('ArrowRight');
    tap();
    complete(utterances().at(-1)!);
    advance();
    expect(said()).toEqual(['Soup']);
    tap(); advance();
    expect(said()).toEqual(['Soup', 'S']);
  });

  it('ignores stale completion callbacks from canceled speech', () => {
    key('ArrowDown');
    const oldUtterance = speech.speak.mock.calls.at(-1)![0];
    key('ArrowRight');
    complete(oldUtterance, 'onend'); complete(oldUtterance, 'onerror');
    tap(); advance();
    expect(said()).toEqual(['Starters', 'Soup']);
    tap(); advance();
    expect(said()).toEqual(['Starters', 'Soup', 'S']);
  });

  it('speaks spaces, punctuation, and Unicode code points without dropping characters', () => {
    const value = 'A ,.!?-’\n😀';
    render({ ...menu, sections: [{ name: 'Test', items: [value] }] });
    key('ArrowRight');
    tap(); advance(); // Stop full text.
    for (const _character of Array.from(value)) { tap(); advance(); }
    expect(said()).toEqual([value, 'A', 'space', 'comma', 'period', 'exclamation mark',
      'question mark', 'hyphen', 'right single quotation mark', 'new line', '😀']);
    expect(text()).toBe(value);
  });

  it('resets spelling when navigating to an item or section, including boundary reversal', () => {
    tap(); advance(); tap(); advance();
    key('ArrowRight'); tap(); advance(); tap(); advance();
    key('ArrowLeft'); // Boundary stops speech without resetting spelling.
    tap(); advance();
    expect(said()).toEqual(['S', 't', 'Soup', 'S', 'o']);
    key('ArrowRight'); // Reversal rereads Soup, resetting spelling.
    tap(); advance(); tap(); advance();
    expect(said().slice(-2)).toEqual(['Soup', 'S']);
    key('ArrowDown'); tap(); advance(); tap(); advance();
    expect(said().slice(-2)).toEqual(['Mains', 'M']);
  });

  it('only thumps when spelling an empty heading', () => {
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
    complete(utterances().at(-1)!);
    tap(); advance(); tap(); advance();
    expect(said()).toEqual(['Starters', 'Mains', '']);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(text()).toBe('');
  });

  it('keeps the spelling cursor across double-tap speed announcements', () => {
    tap(); advance();
    tap(); advance(100); tap();
    expect(said()).toEqual(['S', 'Speed 1.5']);
    tap(); advance();
    expect(said()).toEqual(['S', 'Speed 1.5', 't']);
  });

  it('can spell after optional speech submission fails', () => {
    speech.speak.mockImplementationOnce(() => { throw new Error('Unavailable'); });
    key('ArrowRight');
    tap(); advance();
    expect(said()).toEqual(['Soup', 'S']);
  });

  it('double-click changes speed without an intervening repeat or display change', () => {
    key('ArrowRight');
    doubleClick();
    advance();
    expect(said()).toEqual(['Soup', 'Speed 1.75']);
    expect(onSpeechRateChange).toHaveBeenLastCalledWith(1.75);
    expect(text()).toBe('Soup');
    doubleClick();
    expect(onSpeechRateChange).toHaveBeenLastCalledWith(2);
    click(); advance();
    expect(said().at(-1)).toBe('Speed 2');
    click(); advance();
    expect(said().at(-1)).toBe('S');
    expect(speech.speak.mock.calls.at(-1)![0].rate).toBe(2);
    expect(text()).toBe('Soup');
  });

  it('cycles mouse double-clicks through the existing speech rates', () => {
    for (let i = 0; i < 6; i += 1) doubleClick();
    expect(onSpeechRateChange.mock.calls.map(([rate]) => rate)).toEqual([1.75, 2, 2.5, 1, 1.25, 1.5]);
  });

  it('keyboard navigation cancels pending mouse repeat', () => {
    click(); key('ArrowRight'); advance();
    expect(said()).toEqual(['Soup']);
  });

  it('preserves touch flick navigation', () => {
    flick(0, 80); flick(80, 0); flick(80, 0); flick(-80, 0); flick(0, 80); flick(0, -80);
    expect(said()).toEqual(['Starters', 'Soup', 'Salad', 'Soup', 'Mains', 'Starters']);
  });

  it('plays boundary cues directly at touchend without the tap/double-tap delay', () => {
    touch('touchstart', 100, 100);
    touch('touchmove', 100, 20);
    expect(audio.play).not.toHaveBeenCalled();
    touch('touchend', 100, 20);
    // No timer advancement: a boundary flick must be audible immediately.
    expect(audio.play).toHaveBeenCalledOnce();
    expect(speech.cancel.mock.invocationCallOrder.at(-1)).toBeLessThan(audio.play.mock.invocationCallOrder[0]);
    flick(0, -80);
    expect(audio.play).toHaveBeenCalledTimes(2);
    flick(0, 80);
    expect(said()).toEqual(['Starters']);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it('immediately thumps on every empty-section flick, including reversals', () => {
    flick(0, 80); flick(0, 80); flick(0, 80);
    for (const x of [80, 80, -80, -80, 80]) flick(x, 0);
    expect(audio.play).toHaveBeenCalledTimes(5);
    expect(text()).toBe('');
    expect(said()).toEqual(['Starters', 'Mains', '']);
    advance();
    expect(audio.play).toHaveBeenCalledTimes(5);
  });

  it('interrupts speech before each boundary without repeating menu speech', () => {
    flick(0, 80);
    const cancellations = speech.cancel.mock.calls.length;
    // No onstart is needed: even an unstarted utterance must be canceled.
    flick(-80, 0);
    expect(speech.cancel).toHaveBeenCalledTimes(cancellations + 1);
    expect(speech.cancel.mock.invocationCallOrder.at(-1)).toBeLessThan(audio.play.mock.invocationCallOrder[0]);
    flick(-80, 0); flick(-80, 0);
    advance(1500);
    flick(-80, 0);
    expect(audio.play).toHaveBeenCalledTimes(4);
    expect(speech.cancel).toHaveBeenCalledTimes(cancellations + 4);
    expect(said()).toEqual(['Starters']);
    expect(text()).toBe('Starters');
    act(() => root.render(null));
    expect(speech.cancel).toHaveBeenCalledTimes(cancellations + 5);
  });

  it('does not attach speech-completion audio resets or schedule extra cues', () => {
    flick(0, 80);
    const utterance = utterances().at(-1)!;
    const cancellations = speech.cancel.mock.calls.length;
    complete(utterance, 'onend');
    complete(utterance, 'onerror');
    advance(2000);
    expect(audio.play).not.toHaveBeenCalled();
    expect(speech.cancel).toHaveBeenCalledTimes(cancellations);
  });

  it('continues boundary navigation if optional speech submission throws', () => {
    speech.speak.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('Unavailable'); });
    expect(() => flick(0, 80)).not.toThrow();
    expect(said()).toEqual(['Starters']);
    const cancellations = speech.cancel.mock.calls.length;
    flick(-80, 0); flick(-80, 0);
    expect(speech.cancel).toHaveBeenCalledTimes(cancellations + 2);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it('preserves touch tap timing and ignores its compatibility click', () => {
    tap(); click(); advance(350);
    expect(said()).toEqual(['S']);
    advance();
    expect(said()).toEqual(['S']);
    expect(text()).toBe('Starters');
  });

  it('preserves touch double-tap announcement then cycling, ignoring compatibility double-clicks', () => {
    tap(); advance(100); tap();
    click(2);
    act(() => area().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 })));
    expect(said()).toEqual(['Speed 1.5']);
    expect(onSpeechRateChange).not.toHaveBeenCalled();
    tap(); advance(100); tap(); advance();
    expect(said()).toEqual(['Speed 1.5', 'Speed 1.75']);
    expect(text()).toContain('This is the Quick Nav page.');
  });

  it('allows a real mouse to take over after touch input', () => {
    tap(); advance();
    const event = new Event('pointerdown', { bubbles: true });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    act(() => area().dispatchEvent(event));
    doubleClick();
    expect(said()).toEqual(['S', 'Speed 1.75']);
  });

  it('cancels touch input for multiple fingers and touch cancellation', () => {
    touch('touchstart', 100, 100, 2); touch('touchend', 100, 100);
    touch('touchstart', 100, 100); touch('touchcancel', 100, 100);
    advance();
    expect(said()).toEqual([]);
  });

  it('renders exceptionally long spoken text unchanged', () => {
    const longText = 'Long item '.repeat(10000);
    render({ ...menu, sections: [{ name: 'Long', items: [longText] }] });
    key('ArrowRight');
    expect(text()).toBe(longText);
    expect(said()).toEqual([longText]);
  });

  it('does not repeat speech from the Exit button', () => {
    act(() => container.querySelector<HTMLButtonElement>('button')!.click());
    advance();
    expect(onExit).toHaveBeenCalledOnce();
    expect(said()).toEqual([]);
  });

  it('restores overflow, cancels pending input, and resets instructions on reentry', () => {
    key('ArrowRight'); click();
    act(() => root.render(null));
    expect(document.documentElement.style.overflow).toBe('');
    advance();
    expect(said()).toEqual(['Soup']);
    expect(audio.dispose).toHaveBeenCalledOnce();
    render();
    expect(text()).toContain('This is the Quick Nav page.');
    tap();
    act(() => root.render(null));
    advance();
    expect(said()).toEqual(['Soup']);
  });
});