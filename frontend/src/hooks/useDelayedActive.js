import { useEffect, useState } from 'react';

/**
 * Delays flipping to `true` until `active` remains truthy for `delayMs`.
 * Resets to `false` immediately when `active` becomes falsy.
 * Used to keep UI status chrome calm across transient OS wakeups / sub-second WS reconnects.
 */
export function useDelayedActive(active, delayMs = 1500) {
  const [delayed, setDelayed] = useState(false);

  useEffect(() => {
    if (!active) {
      setDelayed(false);
      return undefined;
    }

    const timer = setTimeout(() => {
      setDelayed(true);
    }, delayMs);

    return () => clearTimeout(timer);
  }, [active, delayMs]);

  return Boolean(active && delayed);
}

export default useDelayedActive;
