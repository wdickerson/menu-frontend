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
  function renderFresh(value: RestaurantMenu) {
    act(() => root.render(null));
    render(value);
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
  function finishWord(word: string) {
    // Finish the word, then each Unicode character in its spelling.
    for (let index = 0; index <= Array.from(word).length; index += 1) {
      complete(utterances().at(-1)!);
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
    expect(said()).toEqual(['Starters', 'Soup']);
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
    expect(said()).toEqual(['Soup', 'Soup']);
    finishWord('Soup');
    expect(said()).toEqual(['Soup', 'Soup', 'S', 'o', 'u', 'p']);
  });

  it('reads a word on the first idle tap even if the silent warm-up is still speaking', () => {
    tap();
    speech.speaking = true;
    advance(199);
    expect(said()).toEqual([]);
    advance(1);
    expect(said()).toEqual(['Starters']);
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

  describe.each(['keyboard', 'touch'] as const)('section item resets with %s input', (input) => {
    const deltas = {
      ArrowUp: [0, -80], ArrowDown: [0, 80],
      ArrowLeft: [-80, 0], ArrowRight: [80, 0],
    } as const;

    function navigate(...arrows: Array<keyof typeof deltas>) {
      for (const arrow of arrows) {
        if (input === 'keyboard') key(arrow);
        else {
          const [x, y] = deltas[arrow];
          flick(x, y);
        }
      }
    }

    beforeEach(() => {
      render({ ...menu, sections: [{ name: 'Starters', items: ['Soup', 'Salad', 'Bread'] }] });
    });

    it.each(['ArrowUp', 'ArrowDown'] as const)('resets items when reversing the %s section boundary', (boundary) => {
      navigate('ArrowDown', 'ArrowRight', 'ArrowRight', boundary);
      expect(said()).toEqual(['Starters', 'Soup', 'Salad']);
      expect(text()).toBe('Salad');
      expect(audio.play).toHaveBeenCalledOnce();
      navigate(boundary === 'ArrowUp' ? 'ArrowDown' : 'ArrowUp');
      expect(text()).toBe('Starters');
      navigate('ArrowRight');
      expect(said()).toEqual(['Starters', 'Soup', 'Salad', 'Starters', 'Soup']);
      expect(audio.play).toHaveBeenCalledOnce();
    });

    it.each(['ArrowUp', 'ArrowDown'] as const)('preserves the item position when %s only thumps', (boundary) => {
      navigate('ArrowDown', 'ArrowRight', 'ArrowRight', boundary, boundary);
      expect(said()).toEqual(['Starters', 'Soup', 'Salad']);
      expect(text()).toBe('Salad');
      expect(audio.play).toHaveBeenCalledTimes(2);
      navigate('ArrowRight');
      expect(said()).toEqual(['Starters', 'Soup', 'Salad', 'Bread']);
      expect(audio.play).toHaveBeenCalledTimes(2);
    });

    it('resets items when the initial section is announced after reading items', () => {
      navigate('ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowRight');
      expect(said()).toEqual(['Soup', 'Salad', 'Starters', 'Soup']);
      expect(audio.play).not.toHaveBeenCalled();
    });

    it('clears a previous item boundary when the section is announced again', () => {
      navigate('ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowUp');
      expect(audio.play).toHaveBeenCalledTimes(2);
      expect(text()).toBe('Bread');
      navigate('ArrowDown', 'ArrowRight');
      expect(said()).toEqual(['Starters', 'Soup', 'Salad', 'Bread', 'Starters', 'Soup']);
      expect(audio.play).toHaveBeenCalledTimes(2);
    });

    it('keeps the first item unread when only a section thump is played', () => {
      const instructions = text();
      navigate('ArrowUp', 'ArrowUp');
      expect(text()).toBe(instructions);
      navigate('ArrowRight');
      expect(said()).toEqual(['Soup']);
      expect(audio.play).toHaveBeenCalledTimes(2);
    });

    it('preserves an item boundary latch when only a section thump is played', () => {
      navigate('ArrowDown', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowRight');
      expect(said()).toEqual(['Starters', 'Soup', 'Soup', 'Salad']);
      expect(audio.play).toHaveBeenCalledTimes(2);
    });

    it('still resets items when moving away from and back to a section', () => {
      render(menu);
      navigate('ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowRight');
      expect(said()).toEqual(['Starters', 'Soup', 'Salad', 'Mains', 'Pasta', 'Starters', 'Soup']);
      expect(audio.play).not.toHaveBeenCalled();
    });
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

  it.each([
    { input: 'touch', delay: 200 },
    { input: 'mouse', delay: 300 },
  ])('reads a word after only $delay ms for $input input', ({ input, delay }) => {
    if (input === 'touch') tap(); else click();
    advance(delay - 1);
    expect(said()).toEqual([]);
    advance(1);
    expect(said()).toEqual(['Starters']);
  });

  it.each(['touch', 'mouse'])('reads and spells successive words on every %s tap, even during menu speech', (input) => {
    const single = () => { if (input === 'touch') tap(); else click(); advance(); };
    render({ ...menu, sections: [{ name: 'Test', items: ['Hot soup'] }] });
    key('ArrowRight');
    const cancellations = speech.cancel.mock.calls.length;
    single();
    expect(said()).toEqual(['Hot soup', 'Hot']);
    expect(speech.cancel).toHaveBeenCalledTimes(cancellations + 1);
    finishWord('Hot');
    expect(said()).toEqual(['Hot soup', 'Hot', 'H', 'o', 't']);
    // Letter continuations must not cancel the preceding word or letters.
    expect(speech.cancel).toHaveBeenCalledTimes(cancellations + 1);
    expect(text()).toBe('Hot soup');
    single();
    expect(said().at(-1)).toBe('soup');
    finishWord('soup');
    expect(said()).toEqual(['Hot soup', 'Hot', 'H', 'o', 't', 'soup', 's', 'o', 'u', 'p']);
    single(); single();
    expect(said().at(-1)).toBe('p');
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(text()).toBe('Hot soup');
  });

  it.each(['onend', 'onerror'] as const)('starts word reading after menu speech %s', (callback) => {
    key('ArrowDown');
    complete(utterances().at(-1)!, callback);
    tap(); advance();
    expect(said()).toEqual(['Starters', 'Starters']);
  });

  it('reads the first word even if menu speech finishes during tap recognition', () => {
    key('ArrowRight');
    tap();
    complete(utterances().at(-1)!);
    advance();
    expect(said()).toEqual(['Soup', 'Soup']);
  });

  it('ignores stale completion callbacks from canceled speech', () => {
    key('ArrowDown');
    const oldUtterance = speech.speak.mock.calls.at(-1)![0];
    key('ArrowRight');
    complete(oldUtterance, 'onend'); complete(oldUtterance, 'onerror');
    tap(); advance();
    expect(said()).toEqual(['Starters', 'Soup', 'Soup']);
    finishWord('Soup');
    expect(said().slice(-4)).toEqual(['S', 'o', 'u', 'p']);
  });

  it('splits words on whitespace and spells punctuation and Unicode without dropping characters', () => {
    const value = ' \tA,\u00a0café!\n😀  ';
    render({ ...menu, sections: [{ name: 'Test', items: [value] }] });
    key('ArrowRight');
    for (const word of ['A,', 'café!', '😀']) {
      tap(); advance(); finishWord(word);
    }
    expect(said()).toEqual([value, 'A,', 'A', 'comma', 'café!', 'c', 'a', 'f', 'é', 'exclamation mark', '😀', '😀']);
    tap(); advance();
    expect(audio.play).toHaveBeenCalledOnce();
    expect(text()).toBe(value);
  });

  it('resets words on navigation and boundary reversal, but not on a thump', () => {
    renderFresh({ ...menu, sections: [{ name: 'First section', items: ['Hot soup'] }] });
    tap(); advance();
    expect(said()).toEqual(['First']);
    key('ArrowRight'); tap(); advance();
    key('ArrowLeft'); // Boundary stops speech without resetting the word cursor.
    tap(); advance();
    expect(said()).toEqual(['First', 'Hot soup', 'Hot', 'soup']);
    key('ArrowRight'); // Reversal rereads the item and resets words.
    tap(); advance();
    expect(said().slice(-2)).toEqual(['Hot soup', 'Hot']);
    key('ArrowUp'); key('ArrowDown'); tap(); advance();
    expect(said().slice(-2)).toEqual(['First section', 'First']);
  });

  describe.each(['word', 'letter'] as const)('while speaking a %s', (stage) => {
    it.each(['next tap', 'navigation', 'speed', 'boundary', 'unmount'] as const)(
      'does not resume stale spelling after %s', (action) => {
        render({ ...menu, sections: [{ name: 'Test', items: ['Hot soup', 'Salad'] }] });
        key('ArrowRight');
        tap(); advance();
        if (stage === 'letter') complete(utterances().at(-1)!);
        const oldUtterance = utterances().at(-1)!;
        if (action === 'next tap') { tap(); advance(); }
        else if (action === 'navigation') key('ArrowRight');
        else if (action === 'speed') { tap(); advance(100); tap(); }
        else if (action === 'boundary') key('ArrowLeft');
        else act(() => root.render(null));
        const spoken = [...said()];
        complete(oldUtterance, 'onend');
        complete(oldUtterance, 'onerror');
        expect(said()).toEqual(spoken);
        if (action === 'next tap') {
          expect(said().at(-1)).toBe('soup');
          finishWord('soup');
          expect(said().slice(-4)).toEqual(['s', 'o', 'u', 'p']);
        }
      },
    );

    it('stops the sequence on speech error and advances on the next tap', () => {
      renderFresh({ ...menu, sections: [{ name: 'Hot soup', items: [] }] });
      click(); advance();
      if (stage === 'letter') complete(utterances().at(-1)!);
      const failed = utterances().at(-1)!;
      complete(failed, 'onerror');
      const spoken = [...said()];
      complete(failed);
      expect(said()).toEqual(spoken);
      click(); advance();
      expect(said().at(-1)).toBe('soup');
    });
  });

  it('ignores duplicate end callbacks without skipping letters', () => {
    click(); advance();
    const word = utterances().at(-1)!;
    complete(word);
    const letter = utterances().at(-1)!;
    complete(word);
    expect(said()).toEqual(['Starters', 'S']);
    complete(letter);
    expect(said()).toEqual(['Starters', 'S', 't']);
  });

  it('recovers on the next word if submitting a spelling letter throws', () => {
    renderFresh({ ...menu, sections: [{ name: 'Hot soup', items: [] }] });
    click(); advance();
    speech.speak.mockImplementationOnce(() => { throw new Error('Unavailable'); });
    expect(() => complete(utterances().at(-1)!)).not.toThrow();
    const failedLetter = utterances().at(-1)!;
    complete(failedLetter);
    expect(said()).toEqual(['Hot', 'H']);
    click(); advance();
    expect(said()).toEqual(['Hot', 'H', 'soup']);
  });

  it('only thumps for whitespace-only text', () => {
    renderFresh({ ...menu, sections: [{ name: ' \t\n ', items: [] }] });
    click(); advance(); click(); advance();
    expect(said()).toEqual([]);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it('only thumps when spelling an empty heading', () => {
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
    complete(utterances().at(-1)!);
    tap(); advance(); tap(); advance();
    expect(said()).toEqual(['Starters', 'Mains', '']);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(text()).toBe('');
  });

  it('keeps the word cursor across double-tap speed announcements', () => {
    renderFresh({ ...menu, sections: [{ name: 'First section', items: [] }] });
    tap(); advance();
    tap(); advance(100); tap();
    expect(said()).toEqual(['First', 'Speed 1.5']);
    tap(); advance();
    expect(said()).toEqual(['First', 'Speed 1.5', 'section']);
  });

  it('can spell after optional speech submission fails', () => {
    speech.speak.mockImplementationOnce(() => { throw new Error('Unavailable'); });
    key('ArrowRight');
    tap(); advance();
    expect(said()).toEqual(['Soup', 'Soup']);
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
    expect(said().at(-1)).toBe('Soup');
    finishWord('Soup');
    expect(said().slice(-4)).toEqual(['S', 'o', 'u', 'p']);
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
    expect(said()).toEqual(['Starters']);
    advance();
    expect(said()).toEqual(['Starters']);
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
    expect(said()).toEqual(['Starters', 'Speed 1.75']);
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