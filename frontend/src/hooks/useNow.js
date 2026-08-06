import { useState, useEffect } from 'react';

let globalNow = Date.now();
const timerListeners = new Set();
let globalInterval = null;

const startGlobalTimer = () => {
  if (globalInterval) return;
  globalInterval = setInterval(() => {
    globalNow = Date.now();
    timerListeners.forEach(listener => listener(globalNow));
  }, 1000);
};

const stopGlobalTimer = () => {
  if (globalInterval) {
    clearInterval(globalInterval);
    globalInterval = null;
  }
};

/**
 * useNow - High-performance unified clock/timer hook.
 * Uses exactly ONE global interval for the entire application,
 * eliminating the thread overhead of multiple concurrent setInterval ticks.
 */
export const useNow = () => {
  const [now, setNow] = useState(globalNow);

  useEffect(() => {
    const handleTick = (tickNow) => setNow(tickNow);
    timerListeners.add(handleTick);
    startGlobalTimer();

    return () => {
      timerListeners.delete(handleTick);
      if (timerListeners.size === 0) {
        stopGlobalTimer();
      }
    };
  }, []);

  return now;
};
