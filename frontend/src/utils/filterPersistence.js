/**
 * Safe, validated localStorage helpers for UI filter selections.
 * Guarded against SSR/Node runtimes, QuotaExceededError, and stale/corrupt storage values.
 */

export const readPersistedFilter = (key, defaultValue, validator = null) => {
  try {
    if (typeof localStorage === 'undefined' || !key) return defaultValue;
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;

    let parsed;
    if (typeof defaultValue === 'boolean') {
      if (raw === 'true') parsed = true;
      else if (raw === 'false') parsed = false;
      else return defaultValue;
    } else if (typeof defaultValue === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) return defaultValue;
      parsed = n;
    } else {
      parsed = raw;
    }

    if (Array.isArray(validator)) {
      return validator.includes(parsed) ? parsed : defaultValue;
    }
    if (typeof validator === 'function') {
      return validator(parsed) ? parsed : defaultValue;
    }
    return parsed;
  } catch {
    return defaultValue;
  }
};

export const writePersistedFilter = (key, value) => {
  try {
    if (typeof localStorage === 'undefined' || !key) return;
    if (value === undefined || value === null) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, String(value));
  } catch {
    // Ignore storage quota or restricted context errors
  }
};

export const readPersistedJson = (key, defaultValue, sanitize = null) => {
  try {
    if (typeof localStorage === 'undefined' || !key) return defaultValue;
    const raw = localStorage.getItem(key);
    if (!raw) return defaultValue;
    const parsed = JSON.parse(raw);
    if (typeof sanitize === 'function') {
      return sanitize(parsed, defaultValue);
    }
    return parsed ?? defaultValue;
  } catch {
    return defaultValue;
  }
};

export const writePersistedJson = (key, value) => {
  try {
    if (typeof localStorage === 'undefined' || !key) return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota or restricted context errors
  }
};

export const sanitizeLogFilters = (raw, fallback = { info: true, warn: true, error: true }) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...fallback };
  }
  return {
    info: typeof raw.info === 'boolean' ? raw.info : fallback.info,
    warn: typeof raw.warn === 'boolean' ? raw.warn : fallback.warn,
    error: typeof raw.error === 'boolean' ? raw.error : fallback.error,
  };
};
