type AudioSession = { type: string };

const WARMUP_EVENTS = ['pointerup', 'touchend', 'keydown', 'keyup', 'click'] as const;

// Decode once, then start a fresh in-memory source directly in each gesture.
// Media playback is only a fallback when the decoded buffer is unavailable.
export function createBoundaryThump() {
  // iPadOS can request a desktop user agent; touch-capable Macs identify it.
  const isIOS = typeof navigator !== 'undefined' && (
    /iPad|iPhone|iPod/.test(navigator.userAgent ?? '')
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
  const recording = isIOS ? 'boundary-thump-ios.wav' : 'boundary-thump.wav';
  const assetUrl = `${import.meta.env.BASE_URL}assets/${recording}`;
  let context: AudioContext | null = null;
  let buffer: AudioBuffer | null = null;
  let source: AudioBufferSourceNode | null = null;
  let warmupSource: AudioBufferSourceNode | null = null;
  let warmedUp = false;
  let loading: AbortController | null = null;
  let audio: HTMLAudioElement | null = null;
  let request = 0;
  let disposed = false;
  let session: { value: AudioSession; previousType: string } | null = null;

  function prepareBuffer() {
    try {
      const Context = window.AudioContext;
      if (!Context || typeof fetch !== 'function') return;
      // Apply playback intent before creating the output, where supported.
      acquireSession();
      const preparedContext = new Context({ latencyHint: 'interactive' });
      context = preparedContext;
      loading = new AbortController();
      void fetch(assetUrl, { signal: loading.signal })
        .then((response) => {
          if (!response.ok) throw new Error('Boundary sound unavailable');
          return response.arrayBuffer();
        })
        .then((data) => {
          if (disposed) return null;
          return preparedContext.decodeAudioData(data);
        })
        .then((decoded) => {
          // Loading never plays a cue: an old gesture must not sound later.
          if (!disposed) buffer = decoded;
        })
        .catch(() => { /* The media fallback remains available on the next gesture. */ });
    } catch { /* Web Audio is optional. */ }
  }

  function prepareAudio() {
    try {
      const clip = new Audio(assetUrl);
      clip.preload = 'metadata';
      return clip;
    } catch {
      return null;
    }
  }

  prepareBuffer();
  if (!context) audio = prepareAudio();

  function restoreSession() {
    const previous = session;
    session = null;
    if (previous) {
      try { previous.value.type = previous.previousType; } catch { /* Optional API. */ }
    }
  }

  function acquireSession() {
    if (session) return;
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

  function stopSource(node: AudioBufferSourceNode | null) {
    if (!node) return;
    node.onended = null;
    try { node.stop(); } catch { /* It may have already ended. */ }
    try { node.disconnect(); } catch { /* Audio is optional. */ }
  }

  function resumeContext() {
    const output = context;
    if (!output || output.state === 'closed' || output.state === 'running') return null;
    // An unactivated startup resume can remain pending instead of rejecting.
    // Always retry inside a new gesture instead of reusing that stuck promise.
    const attempt = output.resume();
    void attempt.catch(() => {}); // Warmup rejection must also be observed.
    return attempt;
  }

  function warmUp() {
    if (disposed || document.hidden || !context || context.state === 'closed') return;
    acquireSession();
    try {
      // Try on entry; if autoplay is blocked, completed interactions retry.
      // Keep resume/start in the event itself, never after fetch/decode or a timer.
      resumeContext();
      if (!warmedUp) {
        const warmup = context.createBufferSource();
        warmupSource = warmup;
        warmup.buffer = context.createBuffer(1, 1, context.sampleRate);
        warmup.connect(context.destination);
        warmup.onended = () => {
          warmup.disconnect();
          if (warmupSource === warmup) warmupSource = null;
        };
        warmup.start(0);
        warmedUp = true;
      }
    } catch {
      stopSource(warmupSource);
      warmupSource = null;
    }
  }

  function cancel() {
    request += 1;
    stopSource(source);
    source = null;
    // Stop playback without discarding the prepared audio.
    try { audio?.pause(); } catch { /* Media is optional. */ }
  }

  function stopForPage() {
    cancel();
    stopSource(warmupSource);
    warmupSource = null;
  }

  function onVisibilityChange() {
    if (document.hidden) stopForPage();
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', stopForPage);
  for (const event of WARMUP_EVENTS) {
    document.addEventListener(event, warmUp, { capture: true });
  }
  warmUp();

  async function play() {
    cancel();
    if (disposed || document.hidden) return;
    // Hold this mode across speech and cues; restore only when Quick Nav exits.
    acquireSession();
    if (context && buffer && context.state !== 'closed') {
      const currentRequest = request;
      let resumed: Promise<void> | null = null;
      try {
        resumed = resumeContext();
        const cue = context.createBufferSource();
        source = cue;
        cue.buffer = buffer;
        cue.connect(context.destination);
        cue.onended = () => {
          cue.disconnect();
          if (source === cue) source = null;
        };
        // Queue immediately even if resume is pending; cancel() can stop it.
        cue.start(0);
      } catch {
        cancel(); // A broken Web Audio implementation can still use media.
      }
      if (source) {
        try { await resumed; } catch {
          if (currentRequest === request) cancel();
        }
        return;
      }
    }

    // Do not wait for unfinished decoding: that would replay stale boundaries.
    audio ??= prepareAudio();
    if (!audio) return;
    const currentRequest = request;
    try {
      if (audio.error) audio.load(); // Retry a real media error on a fresh gesture.
      audio.currentTime = 0;
      // Invoke play() synchronously in the gesture, not a load callback or timer.
      await audio.play();
    } catch {
      if (currentRequest === request) cancel();
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancel();
    stopSource(warmupSource);
    warmupSource = null;
    loading?.abort();
    buffer = null;
    if (context) {
      try { void context.close().catch(() => {}); } catch { /* Optional audio. */ }
      context = null;
    }
    restoreSession();
    if (audio) {
      try { audio.removeAttribute('src'); audio.load(); } catch { /* Optional media. */ }
      audio = null;
    }
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', stopForPage);
    for (const event of WARMUP_EVENTS) {
      document.removeEventListener(event, warmUp, { capture: true });
    }
  }

  return { play, cancel, dispose };
}