// A layer suffix is numeric. Named signals such as ema_dual_cross are peers.
export const isSignalLayer = (key, base) => key.startsWith(`${base}_`) && /^\d+$/.test(key.slice(base.length + 1));
export const belongsToSignal = (key, base) => key === base || isSignalLayer(key, base);
