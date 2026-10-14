import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { flushSync } from 'react-dom';
import type { RestaurantMenu } from './data/menus';
import CameraCapture from './CameraCapture';
import { postMenuImages } from './menuApi';
import { ImagePreparationQueue } from './imagePreparationQueue';
import { installSpeechWarmup } from './speechWarmup';
import { createBoundaryThump } from './boundaryThump';
import { createAppNavigation, type AppRoute } from './appNavigation';
import { addRecentMenu, deleteRecentMenu, getMenuChoices, getSelectedMenu, loadMenuLibrary,
  renameRecentMenu, saveMenuLibrary,
  type MenuLibrary } from './menuLibrary';

type MenuSection = RestaurantMenu['sections'][number];
type MenuItem = MenuSection['items'][number];
type NavigationTarget = 'section' | 'item';
type BoundarySlots = Record<NavigationTarget, -1 | 1 | null>;
type ReadSlots = Record<NavigationTarget, boolean>;
type TouchGesture = {
  startedAt: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isTap: boolean;
};
type PendingTap = {
  endedAt: number;
  x: number;
  y: number;
  timerId: number;
};

const SPEECH_RATES = [1, 1.5, 2, 2.5, 3, 3.5] as const;
type SpeechRate = (typeof SPEECH_RATES)[number];
const SPEECH_RATE_STORAGE_KEY = 'menu-reader.speechRate';
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
  } catch {
    // Keep the reader usable even when storage is blocked or full.
  }
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

type QuickNavProps = {
  menu: RestaurantMenu;
  speechRate: SpeechRate;
  onSpeechRateChange: (rate: SpeechRate) => void;
  onExit: () => void;
};

function QuickNav({ menu, speechRate, onSpeechRateChange, onExit }: QuickNavProps) {
  const gestureAreaRef = useRef<HTMLDivElement | null>(null);
  const speechRateRef = useRef(speechRate);
  const pendingTapRef = useRef<PendingTap | null>(null);
  const adjustingSpeedRef = useRef(false);
  const gestureRef = useRef<TouchGesture | null>(null);
  const sectionIndexRef = useRef(0);
  const itemIndexRef = useRef(0);
  const lastUtteranceRef = useRef(menu.sections[0].name);
  const lastUtteranceTargetRef = useRef<NavigationTarget | null>('section');
  const hasSpokenRef = useRef(false);
  const boundaryThumpRef = useRef<ReturnType<typeof createBoundaryThump> | null>(null);
  const boundarySlotsRef = useRef<BoundarySlots>({ section: null, item: null });
  const readSlotsRef = useRef<ReadSlots>({ section: false, item: false });

  useEffect(() => {
    const boundaryThump = createBoundaryThump();
    boundaryThumpRef.current = boundaryThump;
    gestureAreaRef.current?.focus();
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.documentElement.style.overflow = previousOverflow;
      if (pendingTapRef.current) {
        window.clearTimeout(pendingTapRef.current.timerId);
      }

      // Strict Mode's initial cleanup must not cancel the app's warm-up.
      if (hasSpokenRef.current) window.speechSynthesis?.cancel();
      boundaryThump.dispose();
      boundaryThumpRef.current = null;
    };
  }, []);

  function speakQuickNav(text: string, rate: SpeechRate) {
    boundaryThumpRef.current?.cancel();
    hasSpokenRef.current = true;
    speak(text, rate);
  }

  function playBoundaryThump() {
    window.speechSynthesis?.cancel();
    void boundaryThumpRef.current?.play();
  }

  function speakMenuText(text: string, target: NavigationTarget) {
    lastUtteranceRef.current = text;
    lastUtteranceTargetRef.current = target;
    readSlotsRef.current[target] = true;
    speakQuickNav(text, speechRateRef.current);
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
    speakMenuText(getSpeechText(currentSection.items[nextItemIndex]), 'item');
    return true;
  }

  function readLastUtterance() {
    const target = lastUtteranceTargetRef.current;

    if (target !== null) {
      readSlotsRef.current[target] = true;
    }

    speakQuickNav(lastUtteranceRef.current, speechRateRef.current);
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
    speakQuickNav(text, speechRateRef.current);
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
      readLastUtterance();
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
  ) {
    const boundarySlot = boundarySlotsRef.current[target];

    if (boundarySlot !== null) {
      if (boundarySlot !== direction) {
        readCurrentGestureTarget(target);
        boundarySlotsRef.current[target] = null;
      } else {
        playBoundaryThump();
      }

      return;
    }

    const didMove = moveGestureTarget(target, direction);

    if (!didMove) {
      playBoundaryThump();
      boundarySlotsRef.current[target] = direction;
    }
  }

  function handleTouchStart(event: TouchEvent<HTMLElement>) {
    // Button touches must not repeat speech or change the reading speed.
    if ((event.target as Element).closest('button') || event.touches.length !== 1) {
      endSpeedAdjustment();
      gestureRef.current = null;
      return;
    }

    const point = getTouchCenter(event.touches);
    const startedAt = performance.now();
    const pendingTap = pendingTapRef.current;

    if (pendingTap) {
      const distance = Math.hypot(point.x - pendingTap.x, point.y - pendingTap.y);

      if (startedAt - pendingTap.endedAt <= DOUBLE_TAP_WINDOW && distance <= DOUBLE_TAP_MAX_DISTANCE) {
        // Let an eligible second tap finish before firing the single-tap action.
        window.clearTimeout(pendingTap.timerId);
      } else {
        endSpeedAdjustment();
      }
    }

    gestureRef.current = {
      startedAt,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      isTap: true,
    };
  }

  function handleTouchMove(event: TouchEvent<HTMLElement>) {
    const gesture = gestureRef.current;

    if (!gesture) {
      return;
    }

    if (event.touches.length !== 1) {
      gestureRef.current = null;
      endSpeedAdjustment();
      return;
    }

    const point = getTouchCenter(event.touches);
    gesture.currentX = point.x;
    gesture.currentY = point.y;

    if (Math.abs(point.x - gesture.startX) > TAP_MAX_MOVE || Math.abs(point.y - gesture.startY) > TAP_MAX_MOVE) {
      gesture.isTap = false;
      endSpeedAdjustment();
    }
  }

  function handleFlickEnd(deltaX: number, deltaY: number) {
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (absY >= FLICK_THRESHOLD && absY > absX * 1.2) {
      navigateGestureTarget('section', deltaY > 0 ? 1 : -1);
      return;
    }

    if (absX >= FLICK_THRESHOLD && absX > absY * 1.2) {
      navigateGestureTarget('item', deltaX > 0 ? 1 : -1);
    }
  }

  function handleTouchEnd(event: TouchEvent<HTMLElement>) {
    const gesture = gestureRef.current;

    if (!gesture) {
      return;
    }

    if (event.touches.length > 0) {
      return;
    }

    gestureRef.current = null;

    if (event.changedTouches.length > 0) {
      gesture.currentX = event.changedTouches[0].clientX;
      gesture.currentY = event.changedTouches[0].clientY;
    }

    const deltaX = gesture.currentX - gesture.startX;
    const deltaY = gesture.currentY - gesture.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    const isTap = gesture.isTap
      && absX <= TAP_MAX_MOVE && absY <= TAP_MAX_MOVE
      && performance.now() - gesture.startedAt <= TAP_MAX_DURATION;

    if (isTap) {
      handleSingleFingerTap(gesture);
      return;
    }

    endSpeedAdjustment();
    handleFlickEnd(deltaX, deltaY);
  }

  function handleTouchCancel() {
    gestureRef.current = null;
    endSpeedAdjustment();
  }

  return (
    <main className="screen quick-nav-screen" aria-label="Quick Nav Mode">
      <div
        className="reader-panel gesture-area"
        ref={gestureAreaRef}
        role="region"
        aria-label="Quick Nav gesture area"
        aria-describedby="quick-nav-instructions"
        tabIndex={-1}
        onContextMenu={(event) => event.preventDefault()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
      >
        <p id="quick-nav-instructions" className="quick-nav-instructions">
          {`This is the Quick Nav page.
Turn off screen readers to enable quick nav gestures.
Flick up/down to navigate menu sections.
Flick left/right to navigate items.
Double tap to change reading speed.`}
        </p>
      </div>
      <button className="menu-button exit-quick-nav" type="button" onClick={onExit}>
        Exit Quick Nav Mode
      </button>
    </main>
  );
}

type MenuPageProps = {
  menu: RestaurantMenu | null;
  onCaptureMenu: () => void;
  onSelectRestaurant: () => void;
  onEnterQuickNav: () => void;
  focusTarget: 'capture' | 'load' | 'quick-nav' | null;
  storageWarning: string;
  processing: boolean;
  processingError: string;
  onRetryProcessing: () => void;
  onCancelProcessing: () => void;
  onDismissProcessingError: () => void;
};

function MenuPage({ menu, onCaptureMenu, onSelectRestaurant, onEnterQuickNav, focusTarget,
  storageWarning, processing, processingError, onRetryProcessing, onCancelProcessing,
  onDismissProcessingError }: MenuPageProps) {
  const captureButtonRef = useRef<HTMLButtonElement | null>(null);
  const loadButtonRef = useRef<HTMLButtonElement | null>(null);
  const quickNavButtonRef = useRef<HTMLButtonElement | null>(null);
  const processingHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const processingErrorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (processing) {
      processingHeadingRef.current?.focus();
    } else if (processingError) {
      processingErrorRef.current?.focus();
    } else if (focusTarget === 'capture') {
      captureButtonRef.current?.focus();
    } else if (focusTarget === 'load') {
      loadButtonRef.current?.focus();
    } else if (focusTarget === 'quick-nav') {
      quickNavButtonRef.current?.focus();
    }
  }, [focusTarget, processing, processingError]);

  return (
    <main className="screen menu-screen" aria-label={processing ? 'Menu processing' : menu ? `${menu.restaurantName} menu` : 'Menu reader'}>
      <div className="menu-content">
        <header className="home-introduction">
          <h1>Menu Reader</h1>
          <p>Turn restaurant menus into skimmable audio with quick navigation gestures. Use your phone's camera to capture menus, or reload a recent menu.</p>
        </header>
        <button className="menu-button primary-button" type="button" ref={captureButtonRef} disabled={processing} onClick={onCaptureMenu}>
          Capture a New Menu
        </button>
        <button className="menu-button" type="button" ref={loadButtonRef} disabled={processing} onClick={onSelectRestaurant}>
          Reload a Recent Menu
        </button>
        <button className="menu-button" type="button" ref={quickNavButtonRef} disabled={processing || !menu} onClick={onEnterQuickNav}>
          Enter Quick Nav Mode
        </button>
        {storageWarning && <p className="storage-warning" role="alert">{storageWarning}</p>}
        {processing && <section className="processing-panel" aria-labelledby="processing-title">
          <h2 id="processing-title" ref={processingHeadingRef} tabIndex={-1}>Processing your menu…</h2>
          <div role="status">
            <span className="processing-indicator" aria-hidden="true" />
            <p>This may take 20 seconds or longer. Please keep this page open while your menu is being read.</p>
          </div>
          <button className="menu-button" type="button" onClick={onCancelProcessing}>Cancel processing</button>
        </section>}
        {processingError && <section className="processing-panel">
          <div ref={processingErrorRef} role="alert" tabIndex={-1}><p>{processingError}</p></div>
          <p>{menu && 'Your previous menu is still available. '}You can retry using the same photos or capture a new menu.</p>
          <div className="processing-error-actions">
            <button className="menu-button primary-button" type="button" onClick={onRetryProcessing}>Retry loading menu</button>
            <button className="menu-button" type="button" onClick={onDismissProcessingError}>Dismiss</button>
          </div>
        </section>}
        {!processing && !menu && <p>No menu loaded. Capture a new menu or reload a recent menu to begin.</p>}
        {!processing && menu && <h2 className="menu-restaurant-name">{menu.restaurantName}</h2>}
        {!processing && menu?.sections.map((section, sectionIndex) => (
          <section className="menu-section" key={sectionIndex} aria-labelledby={`menu-section-${sectionIndex}`}>
            <h3 id={`menu-section-${sectionIndex}`}>{section.name}</h3>
            <ul>
              {section.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}

type MenuManagementAction = { id: string; name: string; kind: 'rename' | 'delete' };

function MenuManagementDialog({ action, onClose, onConfirm }: {
  action: MenuManagementAction;
  onClose: () => void;
  onConfirm: (name: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState(action.name);
  const renaming = action.kind === 'rename';

  useEffect(() => {
    dialogRef.current?.showModal();
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  return <dialog ref={dialogRef} className="menu-management-dialog"
    aria-labelledby="management-title" aria-describedby={renaming ? undefined : 'delete-description'}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <form className="management-content" onSubmit={(event) => {
      event.preventDefault();
      if (!renaming || name.trim()) onConfirm(name);
    }}>
      <div>
        <h1 id="management-title">{renaming ? 'Rename menu' : 'Delete menu?'}</h1>
        {renaming ? <div className="menu-name-field">
          <label htmlFor="menu-name">Menu name</label>
          <input id="menu-name" ref={inputRef} value={name} required
            onChange={(event) => setName(event.target.value)} />
        </div> : <p id="delete-description">Delete “{action.name}” from your recent menus? This cannot be undone.</p>}
      </div>
      <div className="management-actions">
        <button className="menu-button" type="button" autoFocus={!renaming} onClick={onClose}>Cancel</button>
        <button className={`menu-button ${renaming ? 'primary-button' : 'destructive-button'}`} type="submit"
          disabled={renaming && !name.trim()}>{renaming ? 'Save' : 'Delete'}</button>
      </div>
    </form>
  </dialog>;
}

function RestaurantSelection({ library, onSelect, onClose, onRename, onDelete, storageWarning,
  action, onAction, onCloseAction }: {
  library: MenuLibrary;
  onSelect: (id: string) => void;
  onClose: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  storageWarning: string;
  action: MenuManagementAction | null;
  onAction: (action: MenuManagementAction) => void;
  onCloseAction: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!action) {
      if (openerRef.current?.isConnected) openerRef.current.focus();
      else headingRef.current?.focus();
    }
  }, [action]);

  return (
    <main
      className="screen"
      aria-labelledby="selection-title"
    >
      <section className="reader-panel selection-panel">
        <p className="eyebrow">Version 21</p>
        <h1 id="selection-title" ref={headingRef} tabIndex={-1}>Recent Menus</h1>
        <p className="selection-note">Load, rename, or delete a saved menu.</p>
        {storageWarning && <p className="storage-warning" role="alert">{storageWarning}</p>}
        <div className="restaurant-options">
          {library.recentMenus.length === 0 && <p>No recent menus. Capture a new menu to get started.</p>}
          {getMenuChoices(library).map(({ id, menu, capturedAt }) => (
            <article className="restaurant-card" key={id} aria-labelledby={`restaurant-${id}`}>
              <h2 id={`restaurant-${id}`}>{menu.restaurantName}</h2>
              {id.startsWith('captured-') && <time className="recent-date" dateTime={capturedAt}>
                Captured {new Date(capturedAt).toLocaleString()}
              </time>}
              <div className="restaurant-card-actions">
                <button className="primary-button" type="button" aria-label={`Load ${menu.restaurantName}`} onClick={() => onSelect(id)}>Load</button>
                {(['rename', 'delete'] as const).map((kind) => <button key={kind} type="button"
                  aria-label={`${kind === 'rename' ? 'Rename' : 'Delete'} ${menu.restaurantName}`}
                  className={kind === 'delete' ? 'destructive-button' : undefined}
                  onClick={(event) => {
                    openerRef.current = event.currentTarget;
                    onAction({ id, name: menu.restaurantName, kind });
                  }}>{kind === 'rename' ? 'Rename' : 'Delete'}</button>)}
              </div>
            </article>
          ))}
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </section>
      {action && <MenuManagementDialog action={action} onClose={onCloseAction}
        onConfirm={(name) => {
          if (action.kind === 'rename') onRename(action.id, name);
          else onDelete(action.id);
          // Deleting the selected menu returns home rather than back to this list.
          if (action.kind !== 'delete' || action.id !== library.selectedId) onCloseAction();
        }} />}
    </main>
  );
}

function App() {
  const [library, setLibrary] = useState<MenuLibrary>(loadMenuLibrary);
  const [route, setRoute] = useState<AppRoute>({ screen: 'menu' });
  const screen = route.screen;
  const routeRef = useRef(route);
  const navigationRef = useRef<ReturnType<typeof createAppNavigation> | null>(null);
  const [focusTarget, setFocusTarget] = useState<MenuPageProps['focusTarget']>(null);
  const [speechRate, setSpeechRate] = useState<SpeechRate>(getSavedSpeechRate);
  const [storageWarning, setStorageWarning] = useState('');
  const [processing, setProcessing] = useState(false);
  const [processingError, setProcessingError] = useState('');
  const pendingImagesRef = useRef<ImagePreparationQueue | null>(null);
  const captureInputRef = useRef<HTMLInputElement | null>(null);
  const uploadRef = useRef<{ controller: AbortController; timeout: number | null } | null>(null);

  useEffect(() => installSpeechWarmup(document, window.speechSynthesis), []);

  useEffect(() => {
    const navigation = createAppNavigation(window, (nextRoute) => {
      const previous = routeRef.current;
      if (nextRoute.screen === 'menu') {
        setFocusTarget(previous.screen === 'capture' ? 'capture'
          : previous.screen === 'selection' ? 'load'
            : previous.screen === 'quick-nav' ? 'quick-nav' : null);
      }
      routeRef.current = nextRoute;
      setRoute(nextRoute);
    });
    navigationRef.current = navigation;
    return () => { navigation.dispose(); navigationRef.current = null; };
  }, []);

  useEffect(() => () => {
    const upload = uploadRef.current;
    uploadRef.current = null;
    if (upload) {
      if (upload.timeout !== null) window.clearTimeout(upload.timeout);
      upload.controller.abort();
    }
    pendingImagesRef.current?.dispose();
  }, []);

  async function processMenu(queue: ImagePreparationQueue | null) {
    if (uploadRef.current || !queue) return;
    pendingImagesRef.current = queue;
    navigationRef.current?.home();
    setFocusTarget(null);
    setProcessingError('');
    setProcessing(true);
    const controller = new AbortController();
    let timedOut = false;
    const upload = { controller, timeout: null as number | null };
    uploadRef.current = upload;
    try {
      const images = await queue.collect(controller.signal);
      if (uploadRef.current !== upload || controller.signal.aborted) return;
      // Give the API its full timeout, regardless of on-device preparation time.
      upload.timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 35_000);
      const menu = await postMenuImages(images, controller.signal);
      if (uploadRef.current?.controller !== controller || controller.signal.aborted) return;
      setLibrary((current) => addRecentMenu(current, menu));
      queue.dispose();
      pendingImagesRef.current = null;
      setFocusTarget('load');
    } catch (error) {
      if (uploadRef.current?.controller === controller) {
        setProcessingError(timedOut ? 'Reading the menu took too long. Try again or capture fewer images.'
          : error instanceof TypeError ? 'Could not reach the menu service. Check your connection and try again.'
            : error instanceof Error ? error.message : 'The menu could not be loaded. Try again.');
      }
    } finally {
      if (upload.timeout !== null) window.clearTimeout(upload.timeout);
      if (uploadRef.current?.controller === controller) {
        uploadRef.current = null;
        setProcessing(false);
      }
    }
  }

  function cancelProcessing() {
    const upload = uploadRef.current;
    uploadRef.current = null;
    if (upload) {
      if (upload.timeout !== null) window.clearTimeout(upload.timeout);
      upload.controller.abort();
    }
    pendingImagesRef.current?.dispose();
    pendingImagesRef.current = null;
    setProcessing(false);
    setProcessingError('');
    setFocusTarget('capture');
  }

  function dismissProcessingError() {
    pendingImagesRef.current?.dispose();
    pendingImagesRef.current = null;
    setProcessingError('');
    setFocusTarget('capture');
  }

  useEffect(() => {
    const saved = saveMenuLibrary(library);
    setStorageWarning(saved ? '' : 'Your menu changes are available for this session, but could not be saved on this device. '
      + 'Allow browser storage or free up space to keep these changes after a reload.');
  }, [library]);

  useEffect(() => {
    savePreference(SPEECH_RATE_STORAGE_KEY, String(speechRate));
  }, [speechRate]);

  if (screen === 'capture') {
    return <CameraCapture
      inputRef={captureInputRef}
      expandedImageId={route.screen === 'capture' ? route.imageId ?? null : null}
      onExpandImage={(imageId) => navigationRef.current?.navigate({ screen: 'capture', imageId })}
      onCloseImage={() => navigationRef.current?.back()}
      onClose={() => navigationRef.current?.home()}
      onSubmit={(images) => void processMenu(images)}
    />;
  }

  if (screen === 'selection') {
    const pendingAction = route.screen === 'selection' ? route.action : undefined;
    const actionMenu = library.recentMenus.find(({ id }) => id === pendingAction?.id);
    const action = pendingAction && actionMenu
      ? { ...pendingAction, name: actionMenu.menu.restaurantName } : null;
    return (
      <RestaurantSelection library={library} storageWarning={storageWarning}
        action={action}
        onAction={({ id, kind }) => navigationRef.current?.navigate({ screen: 'selection', action: { id, kind } })}
        onCloseAction={() => navigationRef.current?.back()}
        onRename={(id, name) => setLibrary((current) => renameRecentMenu(current, id, name))}
        onDelete={(id) => {
          setLibrary((current) => deleteRecentMenu(current, id));
          if (id === library.selectedId) {
            navigationRef.current?.home();
          }
        }}
        onSelect={(id) => {
        setLibrary((current) => ({ ...current, selectedId: id }));
        navigationRef.current?.home();
      }} onClose={() => navigationRef.current?.home()} />
    );
  }

  const selectedMenu = getSelectedMenu(library);
  if (screen === 'quick-nav' && selectedMenu) {
    return (
      <QuickNav
        menu={selectedMenu}
        speechRate={speechRate}
        onSpeechRateChange={setSpeechRate}
        onExit={() => navigationRef.current?.home()}
      />
    );
  }

  return (
    <MenuPage
      menu={selectedMenu}
      focusTarget={focusTarget}
      storageWarning={storageWarning}
      processing={processing}
      processingError={processingError}
      onRetryProcessing={() => void processMenu(pendingImagesRef.current)}
      onCancelProcessing={cancelProcessing}
      onDismissProcessingError={dismissProcessingError}
      onCaptureMenu={() => {
        // Keep the native picker inside the original user gesture on mobile.
        flushSync(() => {
          dismissProcessingError();
          navigationRef.current?.navigate({ screen: 'capture' });
        });
        captureInputRef.current?.click();
      }}
      onEnterQuickNav={() => {
        dismissProcessingError();
        navigationRef.current?.navigate({ screen: 'quick-nav' });
      }}
      onSelectRestaurant={() => {
        dismissProcessingError();
        navigationRef.current?.navigate({ screen: 'selection' });
      }}
    />
  );
}

export default App;