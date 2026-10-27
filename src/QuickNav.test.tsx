// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickNav } from './App';
import type { RestaurantMenu } from './data/menus';

const audio = vi.hoisted(() => ({ play: vi.fn(), cancel: vi.fn(), dispose: vi.fn() }));
vi.mock('./boundaryThump', () => ({ createBoundaryThump: () => audio }));
vi.mock('./screenWakeLock', () => ({ keepScreenAwake: () => () => {} }));

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
  const speech = { speak: vi.fn(), cancel: vi.fn() };
  const onSpeechRateChange = vi.fn();
  const onExit = vi.fn();

  function render(value = menu) {
    act(() => root.render(<QuickNav menu={value} speechRate={1.5}
      onSpeechRateChange={onSpeechRateChange} onExit={onExit} />));
  }

  function area() { return container.querySelector<HTMLElement>('.gesture-area')!; }
  function text() { return container.querySelector('p')!.textContent; }
  function said() { return speech.speak.mock.calls.map(([utterance]) => utterance.text); }
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
    advance(450); // A native double-click may be slower than the touch window.
    click(2);
    act(() => area().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 })));
  }
  function touch(type: string, x: number, y: number, count = 1) {
    const points = Array.from({ length: count }, () => ({ clientX: x, clientY: y }));
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : points },
      changedTouches: { value: points },
    });
    act(() => area().dispatchEvent(event));
  }
  function tap() { touch('touchstart', 100, 100); touch('touchend', 100, 100); }
  function flick(x: number, y: number) {
    touch('touchstart', 100, 100);
    touch('touchmove', 100 + x, 100 + y);
    touch('touchend', 100 + x, 100 + y);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      text: string;
      rate = 1;
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
    expect(text()).toContain('arrow keys');
    expect(document.activeElement).toBe(area());
    expect(said()).toEqual([]);
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

  it('single-click repeats once and replaces initial instructions', () => {
    click();
    expect(said()).toEqual([]);
    advance();
    expect(said()).toEqual(['Starters']);
    expect(text()).toBe('Starters');
    click(); advance();
    expect(said()).toEqual(['Starters', 'Starters']);
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