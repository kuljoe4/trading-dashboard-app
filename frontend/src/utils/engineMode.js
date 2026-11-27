const env = import.meta.env;
export const dualEngineEnabled = env?.VITE_DUAL_ENGINE === 'true';

const readEngineFromSearch = (search) => {
  if (!dualEngineEnabled) return null;
  const params = new URLSearchParams(search || '');
  return params.get('engine') === 'paper' ? 'paper' : 'live';
};

export let selectedEngine = readEngineFromSearch(
  typeof window === 'undefined' ? '' : window.location.search
);

export const getSelectedEngine = () => selectedEngine;

const listeners = new Set();
let popstateHandler = null;

export const subscribeSelectedEngine = (listener) => {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const notifySelectedEngineListeners = () => {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (_) {}
  });
};

export const setSelectedEngine = (mode, { pushHistory = true, resetRouteToRoot = false } = {}) => {
  if (!dualEngineEnabled) return selectedEngine;
  const nextMode = mode === 'paper' ? 'paper' : 'live';
  const changed = nextMode !== selectedEngine;
  selectedEngine = nextMode;

  if (typeof window !== 'undefined' && window.history) {
    try {
      const url = new URL(window.location.href);
      const currentParam = url.searchParams.get('engine');
      const needsUrlUpdate = currentParam !== nextMode || (resetRouteToRoot && url.hash && url.hash !== '#/');
      if (needsUrlUpdate) {
        url.searchParams.set('engine', nextMode);
        if (resetRouteToRoot) {
          url.hash = '#/';
        }
        const method = pushHistory ? 'pushState' : 'replaceState';
        window.history[method]({ engine: nextMode }, '', url.href);
      }
    } catch (_) {}
  }

  if (changed) {
    notifySelectedEngineListeners();
  }
  return selectedEngine;
};

export const registerPopstateEngineHandler = (handler) => {
  popstateHandler = typeof handler === 'function' ? handler : null;
};

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (!dualEngineEnabled) return;
    const urlMode = readEngineFromSearch(window.location.search);
    if (urlMode && urlMode !== selectedEngine) {
      if (popstateHandler) {
        popstateHandler(urlMode);
      } else {
        setSelectedEngine(urlMode, { pushHistory: false });
      }
    }
  });
}

export const enginePath = (mode) => (mode === 'paper' ? '/paper-engine' : '');
export const engineStorageKey = (key, modeOverride = selectedEngine) =>
  modeOverride === 'paper' ? `paper:${key}` : key;
