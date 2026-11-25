import { useState, useCallback } from 'react';
import { readPersistedFilter, writePersistedFilter } from '../utils/filterPersistence.js';

/**
 * Drop-in replacement for React.useState that initializes from and writes synchronously
 * to localStorage on every update, with optional allowlist/predicate validation.
 */
export const usePersistedFilter = (key, defaultValue, validator = null) => {
  const [value, setValueState] = useState(() => readPersistedFilter(key, defaultValue, validator));

  const setValue = useCallback((nextOrUpdater) => {
    setValueState((prev) => {
      const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(prev) : nextOrUpdater;
      writePersistedFilter(key, next);
      return next;
    });
  }, [key]);

  return [value, setValue];
};
