const env = import.meta.env;
export const dualEngineEnabled = env?.VITE_DUAL_ENGINE === 'true';
const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
export const selectedEngine = dualEngineEnabled ? (params.get('engine') === 'paper' ? 'paper' : 'live') : null;
export const enginePath = (mode) => mode === 'paper' ? '/paper-engine' : '';
export const engineStorageKey = (key) => selectedEngine === 'paper' ? `paper:${key}` : key;
