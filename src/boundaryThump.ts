type AudioSession = { type: string };

// Each Quick Nav mount owns its media, pending request, and optional session lease.
export function createBoundaryThump() {
  let active: HTMLAudioElement | null = null;
  let disposed = false;
  let session: { value: AudioSession; previousType: string } | null = null;

  function prepareAudio() {
    let audio: HTMLAudioElement | null = null;
    try {
      audio = new Audio(`${import.meta.env.BASE_URL}assets/boundary-thump.wav`);
      audio.preload = 'auto';
      // Gain is baked into the recording: iOS may ignore media.volume changes.
      audio.load();
      return audio;
    } catch {
      if (audio) releaseAudio(audio);
      return null;
    }
  }

  let prepared = prepareAudio();

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

  function releaseAudio(audio: HTMLAudioElement) {
    audio.onended = null;
    audio.onerror = null;
    audio.onpause = null;
    try { audio.pause(); } catch { /* Media may be unavailable. */ }
    try {
      // Removing the source aborts pending playback/loading, not just audible output.
      audio.removeAttribute('src');
      audio.load();
    } catch { /* Cleanup must not interfere with speech. */ }
  }

  function cancel() {
    if (active) {
      const audio = active;
      active = null;
      releaseAudio(audio);
    }
    restoreSession();
  }

  function onVisibilityChange() {
    if (document.hidden) cancel();
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', cancel);

  async function play() {
    cancel();
    if (disposed || document.hidden) return;
    const audio = prepared ?? prepareAudio();
    prepared = null;
    if (!audio) return;
    // Use a separate element for each request: old promises/events cannot stop
    // or restore the session for a newer thump, even after an interruption.
    active = audio;
    acquireSession();
    const finish = () => { if (active === audio) cancel(); };
    audio.onended = finish;
    audio.onerror = finish;
    audio.onpause = finish;
    try {
      // Invoke play() synchronously in the gesture; never wait for canplay/load.
      await audio.play();
      if (active !== audio) releaseAudio(audio);
    } catch {
      // Blocked/aborted playback is optional; retry only on a fresh gesture.
      finish();
    }
  }

  function dispose() {
    disposed = true;
    cancel();
    if (prepared) releaseAudio(prepared);
    prepared = null;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', cancel);
  }

  return { play, cancel, dispose };
}