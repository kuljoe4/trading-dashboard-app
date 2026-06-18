import { useEffect } from 'react';
import { useTradingStore } from '../store/trading';

/**
 * useResourceFocus hook
 *
 * Implements a lifecycle-scoped subscription contract for resources.
 * When a component mounts, it registers interest in a resource (trade, strategy, etc).
 * When it unmounts, it unregisters.
 * The store aggregates these interests and debounces the 'focus_mode' signal to the backend.
 *
 * @param {string} type - 'trade', 'strategy', 'global_trades', or 'scanner'
 * @param {string|null} id - The specific ID or Label (e.g. BTCUSDT, 'Momentum Strategy')
 */
export const useResourceFocus = (type, id = null) => {
  const registerInterest = useTradingStore(state => state.registerInterest);
  const unregisterInterest = useTradingStore(state => state.unregisterInterest);

  useEffect(() => {
    if (!type) return;

    registerInterest(type, id);
    return () => unregisterInterest(type, id);
  }, [type, id, registerInterest, unregisterInterest]);
};
