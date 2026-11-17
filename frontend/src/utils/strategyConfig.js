/** Missing keys inherit; explicit `default` means this strategy's scan interval. */
export function resolveStrategyConfig(base = {}, override = {}) {
  return {
    ...base, ...override,
    signal_params: { ...base.signal_params, ...override.signal_params },
    signal_timeframes: { ...base.signal_timeframes, ...override.signal_timeframes },
  };
}

export function describeSignalTimeframe(config, key, base = {}) {
  const own = Object.prototype.hasOwnProperty.call(config.signal_timeframes || {}, key);
  const raw = own ? config.signal_timeframes[key] : base.signal_timeframes?.[key];
  return {
    timeframe: raw && raw !== 'default' ? raw : (config.scan_interval || base.scan_interval || '5m'),
    source: own ? (raw === 'default' ? 'Scan default' : 'Custom') : 'Inherited',
  };
}
