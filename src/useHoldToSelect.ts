import { useEffect, useRef, useState } from 'react';

export const RESTAURANT_HOLD_DURATION = 2400;

export function useHoldToSelect(onComplete: () => void) {
  const [holdProgress, setHoldProgress] = useState(0);
  const timerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  function stopTracking() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }

  function cancelHold() {
    stopTracking();
    setHoldProgress(0);
  }

  function startHold() {
    cancelHold();
    const startedAt = performance.now();

    function updateProgress() {
      setHoldProgress(Math.min((performance.now() - startedAt) / RESTAURANT_HOLD_DURATION, 1));
      frameRef.current = window.requestAnimationFrame(updateProgress);
    }

    frameRef.current = window.requestAnimationFrame(updateProgress);
    timerRef.current = window.setTimeout(() => {
      stopTracking();
      setHoldProgress(1);
      onComplete();
    }, RESTAURANT_HOLD_DURATION);
  }

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.hidden) {
        cancelHold();
      }
    }

    window.addEventListener('blur', cancelHold);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopTracking();
      window.removeEventListener('blur', cancelHold);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return { holdProgress, startHold, cancelHold };
}