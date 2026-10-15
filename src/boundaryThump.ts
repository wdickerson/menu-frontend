type AudioSession = { type: string };

// Reuse one media element/session: avoid rebuilding Safari's audio pipeline per cue.
export function createBoundaryThump() {
  let audio: HTMLAudioElement | null = null;
  let request = 0;
  let disposed = false;
  let session: { value: AudioSession; previousType: string } | null = null;

  function prepareAudio() {
    try {
      const clip = new Audio(`${import.meta.env.BASE_URL}assets/boundary-thump.wav`);
      clip.preload = 'auto';
      // Media events are queued; ignore old events if a newer cue is playing.
      clip.onended = () => { if (clip.ended) cancel(); };
      clip.onerror = () => { if (clip.error) cancel(); };
      clip.onpause = () => { if (clip.paused && !clip.ended) cancel(); };
      return clip;
    } catch {
      return null;
    }
  }

  audio = prepareAudio();

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

  function cancel() {
    request += 1;
    // pause() aborts pending play promises; keep the source and decoded clip.
    try { audio?.pause(); } catch { /* Media is optional. */ }
  }

  function onVisibilityChange() {
    if (document.hidden) cancel();
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', cancel);

  async function play() {
    cancel();
    if (disposed || document.hidden) return;
    audio ??= prepareAudio();
    if (!audio) return;
    const currentRequest = request;
    // Hold this mode across speech and cues; restore only when Quick Nav exits.
    acquireSession();
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
    disposed = true;
    cancel();
    restoreSession();
    if (audio) {
      audio.onended = audio.onerror = audio.onpause = null;
      try { audio.removeAttribute('src'); audio.load(); } catch { /* Optional media. */ }
      audio = null;
    }
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', cancel);
  }

  return { play, cancel, dispose };
}