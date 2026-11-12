// Preload one recording and reuse one media element on every device.
export function createBoundaryThump() {
  // Choose once on entry, including iPads using a desktop user agent.
  const isIOS = typeof navigator !== 'undefined' && (
    /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
  const recording = isIOS ? 'boundary-thump-ios.wav' : 'boundary-thump.wav';
  const assetUrl = `${import.meta.env.BASE_URL}assets/${recording}`;
  let audio = prepareAudio();
  let request = 0;
  let disposed = false;

  function prepareAudio() {
    try {
      const clip = new Audio(assetUrl);
      clip.preload = 'auto';
      return clip;
    } catch {
      return null; // Navigation remains usable without audio.
    }
  }

  function cancel() {
    request += 1;
    try { audio?.pause(); } catch { /* Audio is optional. */ }
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
    try {
      if (audio.error) audio.load(); // Retry errors only on a new boundary action.
      if (audio.currentTime !== 0) audio.currentTime = 0;
      // Call inside the gesture, never after loading, a timer, or another promise.
      await audio.play();
    } catch {
      // An older rejected play must not interrupt a newer thump.
      if (currentRequest === request) cancel();
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancel();
    try { audio?.removeAttribute('src'); audio?.load(); } catch { /* Audio is optional. */ }
    audio = null;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', cancel);
  }

  return { play, cancel, dispose };
}