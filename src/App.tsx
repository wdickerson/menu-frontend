import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { restaurantMenus, type RestaurantId, type RestaurantMenu } from './data/menus';
import { MenuCapture } from './MenuCapture';
import { parseRestaurantMenu } from './menuApi';
import { useHoldToSelect } from './useHoldToSelect';

type MenuSection = RestaurantMenu['sections'][number];
type MenuItem = MenuSection['items'][number];
type FingerCount = 1 | 2;
type BrowserWindowWithWebkitAudio = Window & {
  webkitAudioContext?: typeof AudioContext;
};
type NavigationTarget = 'section' | 'item';
type BoundarySlots = Record<NavigationTarget, -1 | 1 | null>;
type ReadSlots = Record<NavigationTarget, boolean>;
type NavigationMode = 'swipe' | 'flick';
type TouchGesture = {
  fingerCount: FingerCount;
  startedAt: number;
  startX: number;
  startY: number;
  anchorX: number;
  anchorY: number;
  currentX: number;
  currentY: number;
  isTap: boolean;
  hasStepped: boolean;
  boundaryDirection: -1 | 1 | null;
};
type PendingTap = {
  endedAt: number;
  x: number;
  y: number;
  timerId: number;
};

const SPEECH_RATES = [1, 1.5, 2, 2.5, 3, 3.5] as const;
type SpeechRate = (typeof SPEECH_RATES)[number];
type MenuId = RestaurantId | 'captured';
type MenuSelection = { id: MenuId; capturedMenu: RestaurantMenu | null };
const RESTAURANT_STORAGE_KEY = 'menu-reader.restaurantId';
const CAPTURED_MENU_STORAGE_KEY = 'menu-reader.capturedMenu';
const SPEECH_RATE_STORAGE_KEY = 'menu-reader.speechRate';
const SWIPE_THRESHOLD = 70;
const FLICK_THRESHOLD = 55;
const TAP_MAX_MOVE = 18;
const TAP_MAX_DURATION = 350;
const DOUBLE_TAP_WINDOW = 350;
const DOUBLE_TAP_MAX_DISTANCE = 40;

function readSavedPreference(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage may be blocked by browser privacy settings.
    return null;
  }
}

function savePreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    // Keep the reader usable even when storage is blocked or full.
    return false;
  }
}

function getSavedMenuSelection(): MenuSelection {
  const savedId = readSavedPreference(RESTAURANT_STORAGE_KEY);
  let capturedMenu: RestaurantMenu | null = null;
  try {
    const savedMenu = readSavedPreference(CAPTURED_MENU_STORAGE_KEY);
    if (savedMenu !== null) capturedMenu = parseRestaurantMenu(JSON.parse(savedMenu));
  } catch {
    // Invalid or outdated stored menus must not break the gesture reader.
  }

  const id = savedId === 'captured' && capturedMenu !== null
    ? 'captured'
    : savedId !== null && Object.prototype.hasOwnProperty.call(restaurantMenus, savedId)
      ? savedId as RestaurantId
      : 'rough-and-tumble';
  return { id, capturedMenu };
}

function getSavedSpeechRate(): SpeechRate {
  const savedRate = Number(readSavedPreference(SPEECH_RATE_STORAGE_KEY));

  return SPEECH_RATES.find((rate) => rate === savedRate) ?? 1.5;
}

function getNextIndex(currentIndex: number, direction: -1 | 1, itemCount: number) {
  const nextIndex = currentIndex + direction;

  if (nextIndex < 0 || nextIndex >= itemCount) {
    return null;
  }

  return nextIndex;
}

function getSpeechText(item: MenuItem) {
  return item;
}

function getNavigationMode(): NavigationMode {
  const mode = new URLSearchParams(window.location.search).get('mode');

  return mode === 'swipe' ? 'swipe' : 'flick';
}

function getTouchCenter(touches: TouchEvent<HTMLElement>['touches']) {
  let x = 0;
  let y = 0;

  for (let index = 0; index < touches.length; index += 1) {
    x += touches[index].clientX;
    y += touches[index].clientY;
  }

  return {
    x: x / touches.length,
    y: y / touches.length,
  };
}

function speak(text: string, rate: SpeechRate) {
  if (!('speechSynthesis' in window)) {
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = rate;
  window.speechSynthesis.speak(utterance);
}

function createAudioContext() {
  const AudioContextConstructor =
    window.AudioContext ?? (window as BrowserWindowWithWebkitAudio).webkitAudioContext;

  if (!AudioContextConstructor) {
    return null;
  }

  return new AudioContextConstructor();
}

type MenuReaderProps = {
  menu: RestaurantMenu;
  speechRate: SpeechRate;
  storageNotice: string;
  onSpeechRateChange: (rate: SpeechRate) => void;
  onSelectRestaurant: () => void;
};

function MenuReader({ menu, speechRate, storageNotice, onSpeechRateChange, onSelectRestaurant }: MenuReaderProps) {
  const navigationMode = getNavigationMode();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [itemIndex, setItemIndex] = useState(0);
  const { holdProgress, startHold, cancelHold } = useHoldToSelect(onSelectRestaurant);
  const speechRateRef = useRef(speechRate);
  const pendingTapRef = useRef<PendingTap | null>(null);
  const adjustingSpeedRef = useRef(false);
  const gestureRef = useRef<TouchGesture | null>(null);
  const sectionIndexRef = useRef(sectionIndex);
  const itemIndexRef = useRef(itemIndex);
  const lastUtteranceRef = useRef(menu.sections[0].name);
  const lastUtteranceTargetRef = useRef<NavigationTarget | null>('section');
  const audioContextRef = useRef<AudioContext | null>(null);
  const boundarySlotsRef = useRef<BoundarySlots>({ section: null, item: null });
  const readSlotsRef = useRef<ReadSlots>({ section: false, item: false });

  useEffect(() => {
    headingRef.current?.focus();
    return () => {
      if (pendingTapRef.current) {
        window.clearTimeout(pendingTapRef.current.timerId);
      }

      void audioContextRef.current?.close();
    };
  }, []);

  const section = menu.sections[sectionIndex];
  const item = section.items[itemIndex];
  const speechText = getSpeechText(item);

  function playBoundaryThump() {
    window.speechSynthesis?.cancel();

    const audioContext = audioContextRef.current ?? createAudioContext();

    if (!audioContext) {
      return;
    }

    audioContextRef.current = audioContext;

    if (audioContext.state === 'suspended') {
      void audioContext.resume();
    }

    const startTime = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(120, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(72, startTime + 0.16);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(5.0, startTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.18);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + 0.2);
  }

  function speakMenuText(text: string, target: NavigationTarget) {
    lastUtteranceRef.current = text;
    lastUtteranceTargetRef.current = target;
    readSlotsRef.current[target] = true;
    speak(text, speechRateRef.current);
  }

  function chooseSection(direction: -1 | 1) {
    const nextSectionIndex = getNextIndex(
      sectionIndexRef.current,
      direction,
      menu.sections.length,
    );

    if (nextSectionIndex === null) {
      return false;
    }

    const nextSection = menu.sections[nextSectionIndex];
    const nextItemIndex = 0;

    sectionIndexRef.current = nextSectionIndex;
    itemIndexRef.current = nextItemIndex;
    boundarySlotsRef.current.section = null;
    boundarySlotsRef.current.item = null;
    readSlotsRef.current.section = true;
    readSlotsRef.current.item = false;
    setSectionIndex(nextSectionIndex);
    setItemIndex(nextItemIndex);
    speakMenuText(nextSection.name, 'section');
    return true;
  }

  function chooseItem(direction: -1 | 1) {
    const currentSection = menu.sections[sectionIndexRef.current];
    const nextItemIndex = getNextIndex(
      itemIndexRef.current,
      direction,
      currentSection.items.length,
    );

    if (nextItemIndex === null) {
      return false;
    }

    itemIndexRef.current = nextItemIndex;
    boundarySlotsRef.current.item = null;
    readSlotsRef.current.item = true;
    setItemIndex(nextItemIndex);
    speakMenuText(getSpeechText(currentSection.items[nextItemIndex]), 'item');
    return true;
  }

  function readLastUtterance() {
    const target = lastUtteranceTargetRef.current;

    if (target !== null) {
      readSlotsRef.current[target] = true;
    }

    speak(lastUtteranceRef.current, speechRateRef.current);
  }

  function readCurrentGestureTarget(target: NavigationTarget) {
    if (target === 'section') {
      speakMenuText(menu.sections[sectionIndexRef.current].name, 'section');
      return;
    }

    const currentSection = menu.sections[sectionIndexRef.current];
    speakMenuText(getSpeechText(currentSection.items[itemIndexRef.current]), 'item');
  }

  function clearPendingTap() {
    if (pendingTapRef.current) {
      window.clearTimeout(pendingTapRef.current.timerId);
      pendingTapRef.current = null;
    }
  }

  function endSpeedAdjustment() {
    clearPendingTap();
    adjustingSpeedRef.current = false;
  }

  function announceSpeed() {
    if (adjustingSpeedRef.current) {
      const nextIndex = (SPEECH_RATES.indexOf(speechRateRef.current) + 1) % SPEECH_RATES.length;
      speechRateRef.current = SPEECH_RATES[nextIndex];
      onSpeechRateChange(speechRateRef.current);
    }

    adjustingSpeedRef.current = true;
    const text = `Speed ${speechRateRef.current}`;
    lastUtteranceRef.current = text;
    lastUtteranceTargetRef.current = null;
    speak(text, speechRateRef.current);
  }

  function handleSingleFingerTap(gesture: TouchGesture) {
    if (pendingTapRef.current) {
      clearPendingTap();
      announceSpeed();
      return;
    }

    // Wait briefly so a double tap announces only the speed, not a menu entry first.
    const timerId = window.setTimeout(() => {
      pendingTapRef.current = null;
      adjustingSpeedRef.current = false;

      if (navigationMode === 'flick') {
        readLastUtterance();
      } else {
        readCurrentGestureTarget('section');
      }
    }, DOUBLE_TAP_WINDOW);

    pendingTapRef.current = {
      endedAt: performance.now(),
      x: gesture.currentX,
      y: gesture.currentY,
      timerId,
    };
  }

  function moveGestureTarget(target: NavigationTarget, direction: -1 | 1) {
    if (!readSlotsRef.current[target]) {
      if (direction === -1) {
        return false;
      }

      readCurrentGestureTarget(target);
      return true;
    }

    return target === 'section'
      ? chooseSection(direction)
      : chooseItem(direction);
  }

  function navigateGestureTarget(
    target: NavigationTarget,
    direction: -1 | 1,
    gesture?: TouchGesture,
  ) {
    const boundarySlot = boundarySlotsRef.current[target];

    if (boundarySlot !== null) {
      if (boundarySlot !== direction) {
        readCurrentGestureTarget(target);
        boundarySlotsRef.current[target] = null;

        if (gesture) {
          gesture.boundaryDirection = null;
        }
      } else if (!gesture || gesture.boundaryDirection !== direction) {
        playBoundaryThump();

        if (gesture) {
          gesture.boundaryDirection = direction;
        }
      }

      return;
    }

    if (gesture && gesture.boundaryDirection !== null && gesture.boundaryDirection !== direction) {
      readCurrentGestureTarget(target);
      gesture.boundaryDirection = null;
      return;
    }

    const didMove = moveGestureTarget(target, direction);

    if (didMove) {
      if (gesture) {
        gesture.boundaryDirection = null;
      }
    } else {
      playBoundaryThump();
      boundarySlotsRef.current[target] = direction;

      if (gesture) {
        gesture.boundaryDirection = direction;
      }
    }
  }

  function handleTouchStart(event: TouchEvent<HTMLElement>) {
    cancelHold();
    const fingerCount = event.touches.length;

    if (fingerCount !== 1) {
      endSpeedAdjustment();
    }

    if (fingerCount !== 1 && fingerCount !== 2) {
      gestureRef.current = null;
      return;
    }

    if (navigationMode === 'flick' && fingerCount !== 1) {
      gestureRef.current = null;
      return;
    }

    const point = getTouchCenter(event.touches);
    const startedAt = performance.now();
    const pendingTap = pendingTapRef.current;

    if (fingerCount === 1 && pendingTap) {
      const distance = Math.hypot(point.x - pendingTap.x, point.y - pendingTap.y);

      if (startedAt - pendingTap.endedAt <= DOUBLE_TAP_WINDOW && distance <= DOUBLE_TAP_MAX_DISTANCE) {
        // Let an eligible second tap finish before firing the single-tap action.
        window.clearTimeout(pendingTap.timerId);
      } else {
        endSpeedAdjustment();
      }
    }

    gestureRef.current = {
      fingerCount,
      startedAt,
      startX: point.x,
      startY: point.y,
      anchorX: point.x,
      anchorY: point.y,
      currentX: point.x,
      currentY: point.y,
      isTap: true,
      hasStepped: false,
      boundaryDirection: null,
    };

    if (fingerCount === 1) {
      startHold();
    }
  }

  function handleTouchMove(event: TouchEvent<HTMLElement>) {
    const gesture = gestureRef.current;

    if (!gesture) {
      return;
    }

    if (event.touches.length !== gesture.fingerCount) {
      gesture.isTap = false;
      cancelHold();
      endSpeedAdjustment();

      if (event.touches.length > 2) {
        gestureRef.current = null;
      }

      return;
    }

    const point = getTouchCenter(event.touches);
    gesture.currentX = point.x;
    gesture.currentY = point.y;

    if (Math.abs(point.x - gesture.startX) > TAP_MAX_MOVE || Math.abs(point.y - gesture.startY) > TAP_MAX_MOVE) {
      gesture.isTap = false;
      cancelHold();
      endSpeedAdjustment();
    }

    if (navigationMode === 'flick') {
      return;
    }

    const deltaX = point.x - gesture.anchorX;
    const deltaY = point.y - gesture.anchorY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (absY < SWIPE_THRESHOLD || absY <= absX * 1.2) {
      return;
    }

    const steps = Math.trunc(absY / SWIPE_THRESHOLD);
    const physicalDirection = deltaY > 0 ? 1 : -1;
    const direction = (physicalDirection * -1) as -1 | 1;

    for (let step = 0; step < steps; step += 1) {
      navigateGestureTarget(gesture.fingerCount === 1 ? 'section' : 'item', direction, gesture);
    }

    gesture.anchorX = point.x;
    gesture.anchorY += steps * SWIPE_THRESHOLD * physicalDirection;
    gesture.hasStepped = true;
  }

  function handleFlickEnd(deltaX: number, deltaY: number) {
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (absY >= FLICK_THRESHOLD && absY > absX * 1.2) {
      navigateGestureTarget('section', deltaY < 0 ? 1 : -1);
      return;
    }

    if (absX >= FLICK_THRESHOLD && absX > absY * 1.2) {
      navigateGestureTarget('item', deltaX < 0 ? 1 : -1);
    }
  }

  function handleTouchEnd(event: TouchEvent<HTMLElement>) {
    cancelHold();
    const gesture = gestureRef.current;

    if (!gesture) {
      return;
    }

    if (event.touches.length > 0) {
      return;
    }

    gestureRef.current = null;

    if (gesture.fingerCount === 1 && event.changedTouches.length > 0) {
      gesture.currentX = event.changedTouches[0].clientX;
      gesture.currentY = event.changedTouches[0].clientY;
    }

    const deltaX = gesture.currentX - gesture.startX;
    const deltaY = gesture.currentY - gesture.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    const isTap = gesture.isTap && !gesture.hasStepped
      && absX <= TAP_MAX_MOVE && absY <= TAP_MAX_MOVE
      && performance.now() - gesture.startedAt <= TAP_MAX_DURATION;

    if (isTap && gesture.fingerCount === 1) {
      handleSingleFingerTap(gesture);
      return;
    }

    endSpeedAdjustment();

    if (navigationMode === 'flick') {
      handleFlickEnd(deltaX, deltaY);
      return;
    }

    if (isTap && gesture.fingerCount === 2) {
      readCurrentGestureTarget('item');
    }
  }

  function handleTouchCancel() {
    cancelHold();
    gestureRef.current = null;
    endSpeedAdjustment();
  }

  return (
    <main
      className="screen reader-screen"
      aria-labelledby="app-title"
      onContextMenu={(event) => event.preventDefault()}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onSelectRestaurant();
      }}
    >
      <section className="reader-panel" aria-label="Menu speech reader">
        <p className="eyebrow">Version 11</p>
        <h1 id="app-title" ref={headingRef} tabIndex={-1}>Menu Reader</h1>
        <div className="restaurant-info">
          <p className="restaurant">{menu.restaurantName}</p>
          <p className="reading-speed">Speed: {speechRate}×</p>
          {storageNotice && <p className="reading-speed" role="status">{storageNotice}</p>}
        </div>

        <div className="menu-item" aria-live="polite">
          <p className="section-label">
            {section.name} {sectionIndex + 1} of {menu.sections.length}
          </p>
          <p className="item-text">{item}</p>
        </div>

        <p className="gesture-note">Item {itemIndex + 1} of {section.items.length}</p>
        <span className="sr-only">Hold one finger on the screen to choose or capture a menu. Keyboard users can press Escape.</span>
        <span className="sr-only">{speechText}</span>
      </section>
      <progress
        className="hold-progress"
        aria-label="Hold for restaurant selection"
        max={1}
        value={holdProgress}
      />
    </main>
  );
}

type RestaurantSelectionProps = {
  capturedMenu: RestaurantMenu | null;
  onSelect: (id: MenuId) => void;
  onCapture: () => void;
  onBack: () => void;
};

function RestaurantSelection({ capturedMenu, onSelect, onCapture, onBack }: RestaurantSelectionProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const canSelectRef = useRef(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main
      className="screen selection-screen"
      aria-labelledby="selection-title"
      onPointerDown={() => { canSelectRef.current = true; }}
      onTouchStart={() => { canSelectRef.current = true; }}
      onClickCapture={(event) => {
        // Releasing the opening hold must not select a button beneath that finger.
        if (!canSelectRef.current && event.detail !== 0) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <section className="reader-panel selection-panel">
        <p className="eyebrow">Version 11</p>
        <h1 id="selection-title" ref={headingRef} tabIndex={-1}>Choose a menu</h1>
        <p className="selection-note">Capture your own menu, or select an example menu to return to the reader.</p>
        <div className="restaurant-options">
          <button className="primary-button" type="button" onClick={onCapture}>Capture Menu Images</button>
          {capturedMenu && (
            <button type="button" onClick={() => onSelect('captured')}>
              {capturedMenu.restaurantName}<span className="saved-menu-label">Your last captured menu</span>
            </button>
          )}
          {(Object.keys(restaurantMenus) as RestaurantId[]).map((id) => (
            <button key={id} type="button" onClick={() => onSelect(id)}>
              {restaurantMenus[id].restaurantName}
            </button>
          ))}
          <button type="button" onClick={onBack}>Return to current menu</button>
        </div>
      </section>
    </main>
  );
}

function App() {
  const [selection, setSelection] = useState<MenuSelection>(getSavedMenuSelection);
  const [screen, setScreen] = useState<'reader' | 'selection' | 'capture'>('reader');
  const [speechRate, setSpeechRate] = useState<SpeechRate>(getSavedSpeechRate);
  const [storageNotice, setStorageNotice] = useState('');

  useEffect(() => {
    // Store the transcription, never the photos. Write it before its selection marker.
    if (selection.capturedMenu && !savePreference(CAPTURED_MENU_STORAGE_KEY, JSON.stringify(selection.capturedMenu))) {
      try {
        // Never restore an older transcription as if it were the newly captured menu.
        window.localStorage.removeItem(CAPTURED_MENU_STORAGE_KEY);
      } catch { /* Storage may be completely blocked. */ }
      if (selection.id === 'captured') {
        savePreference(RESTAURANT_STORAGE_KEY, 'rough-and-tumble');
        setStorageNotice('This menu could not be saved on this device. It will be lost on reload.');
        return;
      }
    }
    setStorageNotice('');
    savePreference(RESTAURANT_STORAGE_KEY, selection.id);
  }, [selection]);

  useEffect(() => {
    savePreference(SPEECH_RATE_STORAGE_KEY, String(speechRate));
  }, [speechRate]);

  if (screen === 'capture') {
    return (
      <MenuCapture
        onBack={() => setScreen('selection')}
        onAnnounce={(text) => speak(text, speechRate)}
        onMenuReady={(menu) => {
          setSelection({ id: 'captured', capturedMenu: menu });
          setScreen('reader');
          speak(`${menu.restaurantName}. Menu ready. ${menu.sections.length} sections. ${menu.sections[0].name}.`, speechRate);
        }}
      />
    );
  }

  if (screen === 'selection') {
    return (
      <RestaurantSelection
        capturedMenu={selection.capturedMenu}
        onSelect={(id) => {
          window.speechSynthesis?.cancel();
          setSelection((current) => ({ ...current, id }));
          setScreen('reader');
        }}
        onCapture={() => {
          setScreen('capture');
          speak('Capture your menu. Take a photo or choose photos. Add all pages before submitting.', speechRate);
        }}
        onBack={() => {
          window.speechSynthesis?.cancel();
          setScreen('reader');
        }}
      />
    );
  }

  const menu = selection.id === 'captured'
    ? selection.capturedMenu ?? restaurantMenus['rough-and-tumble']
    : restaurantMenus[selection.id];

  return (
    <MenuReader
      key={selection.id}
      menu={menu}
      speechRate={speechRate}
      storageNotice={storageNotice}
      onSpeechRateChange={setSpeechRate}
      onSelectRestaurant={() => {
        window.speechSynthesis?.cancel();
        setScreen('selection');
      }}
    />
  );
}

export default App;