export interface ExitEstimationComponents {
  fastValue?: number;
  slowValue?: number;
  spread?: number;
  spreadVelocity?: number;
  priceVelocity?: number;
  atr?: number;
}

export type ExitState = 'approaching' | 'diverging' | 'ready' | 'fired' | 'blocked' | 'stale';

export type ExitMethod =
  | 'price_distance'
  | 'indicator_convergence'
  | 'dual_convergence'
  | 'momentum_projection'
  | 'pattern_state'
  | 'event_state';

export interface ExitEstimation {
  signalType: string;
  state: ExitState;
  proximity: number; // 0 - 100
  etaCandles: number | null;
  etaSeconds: number | null;
  confidence: number; // 0 - 100
  estimatedExitPrice: number | null;
  estimatedPnl: number | null;
  estimatedR: number | null;
  method: ExitMethod;
  description: string;
  components?: ExitEstimationComponents;
}

export interface CompositeExitEstimation {
  selectedSignalKey: string | null;
  state: ExitState;
  proximity: number;
  etaCandles: number | null;
  etaSeconds: number | null;
  confidence: number;
  estimatedExitPrice: number | null;
  estimatedPnl: number | null;
  estimatedR: number | null;
  description: string;
  signalEstimations: Record<string, ExitEstimation>;
}
