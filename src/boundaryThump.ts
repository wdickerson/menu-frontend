type AudioSession = { type: string };
type ActiveThump = { oscillator: OscillatorNode; gain: GainNode };

function createAudioContext() {
  const Constructor = window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Constructor ? new Constructor() : null;
}

// Each Quick Nav mount owns its context, pending request, and optional session lease.
export function createBoundaryThump() {
  let context: AudioContext | null = null;
  let active: ActiveThump | null = null;
  let request = 0;
  let disposed = false;
  let session: { value: AudioSession; previousType: string } | null = null;

  function restoreSession() {
    const previous = session;
    session = null;
    if (previous) {
      try { previous.value.type = previous.previousType; } catch { /* Optional API. */ }
    }
  }

  function acquireSession() {
    try {
      const value = (navigator as Navigator & { audioSession?: AudioSession }).audioSession;
      if (value && 'type' in value) {
        session = { value, previousType: value.type };
        value.type = 'playback';
      }
    } catch {
      restoreSession();
    }
  }

  function releaseNodes(thump: ActiveThump) {
    thump.oscillator.onended = null;
    try { thump.oscillator.stop(); } catch { /* Already stopped or not started. */ }
    try { thump.oscillator.disconnect(); } catch { /* Context may be closed. */ }
    try { thump.gain.disconnect(); } catch { /* Context may be closed. */ }
  }

  function cancel() {
    request += 1;
    if (active) {
      const thump = active;
      active = null;
      releaseNodes(thump);
    }
    restoreSession();
  }

  function onStateChange() {
    // Never leave a scheduled sound waiting to replay after an interruption.
    if (active && context?.state !== 'running') cancel();
  }

  async function play() {
    cancel();
    if (disposed) return;
    const currentRequest = request;
    acquireSession();

    try {
      if (context?.state === 'closed') {
        context.removeEventListener('statechange', onStateChange);
        context = null;
      }
      if (!context) {
        context = createAudioContext();
        context?.addEventListener('statechange', onStateChange);
      }
      const audioContext = context;
      if (!audioContext) {
        restoreSession();
        return;
      }
      // Safari can report the nonstandard 'interrupted' state. Resume in the
      // gesture call stack, but schedule only after the context is running.
      const state: string = audioContext.state;
      if (state === 'suspended' || state === 'interrupted') await audioContext.resume();
      if (disposed || currentRequest !== request || context !== audioContext) return;
      if (audioContext.state !== 'running') {
        restoreSession();
        return;
      }

      const oscillator = audioContext.createOscillator();
      // Track even partially constructed nodes so failures release them.
      let gain: GainNode;
      try { gain = audioContext.createGain(); } catch (error) {
        oscillator.disconnect();
        throw error;
      }
      const thump = { oscillator, gain };
      active = thump;
      const startTime = audioContext.currentTime;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(280, startTime);
      oscillator.frequency.exponentialRampToValueAtTime(220, startTime + 0.16);
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.6, startTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.18);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.onended = () => {
        if (active !== thump) return;
        active = null;
        releaseNodes(thump);
        restoreSession();
      };
      oscillator.start(startTime);
      oscillator.stop(startTime + 0.2);
    } catch {
      // Audio is optional; failures must not break navigation or speech.
      if (currentRequest === request) cancel();
    }
  }

  function dispose() {
    disposed = true;
    cancel();
    const previous = context;
    context = null;
    if (previous) {
      previous.removeEventListener('statechange', onStateChange);
      try {
        if (previous.state !== 'closed') void previous.close().catch(() => {});
      } catch { /* Closing an unavailable context must not break cleanup. */ }
    }
  }

  return { play, cancel, dispose };
}