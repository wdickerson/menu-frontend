const WARMUP_EVENTS = ['pointerup', 'touchend', 'keyup', 'click'] as const;

export function installSpeechWarmup(target: EventTarget, synthesis: SpeechSynthesis | undefined) {
  if (!synthesis || typeof SpeechSynthesisUtterance === 'undefined') return () => {};

  const speech = synthesis;
  let startupAttempt = false;
  let activeUtterance: SpeechSynthesisUtterance | null = null;
  let disposed = false;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;

  function cleanup() {
    disposed = true;
    clearTimeout(startupTimer);
    for (const event of WARMUP_EVENTS) {
      target.removeEventListener(event, warmUp, { capture: true });
    }
  }

  function warmUp(event?: Event) {
    if (disposed) return;

    // A cold browser can leave startup speech queued without start/error events.
    // Replace only our unstarted startup request inside an activated click.
    if (event?.type === 'click' && startupAttempt && activeUtterance && !speech.speaking) {
      activeUtterance = null;
      startupAttempt = false;
      speech.cancel();
    }

    // Never interrupt or queue a silent trigger behind existing speech.
    if (activeUtterance || speech.speaking || speech.pending) return;

    try {
      // Use a real word silently, leaving voice and language at browser defaults.
      const utterance = new SpeechSynthesisUtterance('ready');
      utterance.volume = 0.00;
      activeUtterance = utterance;
      startupAttempt = !event;
      utterance.onstart = () => {
        if (disposed || activeUtterance !== utterance) return;
        cleanup();
      };
      utterance.onerror = () => {
        if (disposed || activeUtterance !== utterance) return;
        // Autoplay rejection can be asynchronous. Keep the interaction fallback.
        activeUtterance = null;
      };
      speech.speak(utterance);
    } catch {
      activeUtterance = null;
      // A blocked trigger must not break the interaction; retry on the next one.
    }
  }

  // Use completed interactions: touch pointerdown can precede the browser's
  // user activation required for speech on a freshly navigated page.
  // Capture runs before button handlers; click covers assistive activation.
  for (const event of WARMUP_EVENTS) {
    target.addEventListener(event, warmUp, { capture: true });
  }

  // Try on page load. Deferring one task lets Strict Mode clean up its first
  // effect setup before it can queue speech; user input remains the fallback.
  startupTimer = setTimeout(warmUp, 0);

  return cleanup;
}