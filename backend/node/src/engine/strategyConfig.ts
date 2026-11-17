/** Keep the same precedence contract as the frontend strategyConfig resolver. */
export function resolveStrategyConfig<T>(base: T, override: Partial<T>): T {
  const b = base as any;
  const v = override as any;
  return {
    ...b, ...v,
    signal_params: { ...b.signal_params, ...v.signal_params },
    signal_timeframes: { ...b.signal_timeframes, ...v.signal_timeframes },
  };
}
