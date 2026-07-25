export class Trade {
  id: string = '';

  symbol: string = '';

  direction: 'LONG' | 'SHORT' = 'LONG';

  entry_price: number = 0;

  qty: number = 0;

  /** @deprecated Use qty */
  quantity?: number;

  /** @deprecated Legacy funding tracking */
  _last_funding_delta?: number;

  initial_sl: number = 0;

  current_sl: number = 0;

  sl_price?: number;

  max_rr_achieved: number = 0;

  min_rr_achieved?: number = 0;

  exit_rr?: number = 0;

  rr_sequence_index: number = -1;

  entry_ts?: Date;

  tp?: number | null = 0;

  pnl: number = 0;

  realized_fee: number = 0;

  funding_fee: number = 0;

  risk_usdt: number = 0;

  initial_risk_usdt?: number | null;

  status: 'OPEN' | 'CLOSED' | 'CLOSED_SL' | 'CLOSED_TP' | 'CLOSED_SIGNAL' | 'CLOSED_ORPHANED' = 'OPEN';

  exit_ts?: Date;

  exit_price?: number;

  mark_price?: number;

  last_price?: number;

  exit_reason?: string;

  exit_signal_type?: string;

  exit_signal_reason?: string;

  exit_signals_status?: Record<string, {
    fired: boolean;
    active: boolean;
    remaining_delay: number;
    label: string;
    value: number;
    threshold: number;
    unit: string;
    description?: string;
    insufficientData?: boolean;
    threshold_is_price?: boolean;
  }>;

  entry_signal_type?: string;

  entry_signal_confidence = 0;

  sl_adjustments?: {
    timestamp: string;
    prev_sl: number;
    new_sl: number;
    reason: string;
    milestone_index: number;
    max_rr_achieved?: number;
    adaptive?: boolean;
  }[];

  pnl_pct?: number;

  entry_daily_change_pct?: number;

  binance_order_id?: string;

  binance_close_order_id?: string;

  binance_stop_order_id?: string;

  binance_stop_order_type?: 'standard' | 'algo';

  close_attempts?: number;

  last_close_attempt_ts?: number;

  close_blocked?: boolean;

  sessionId?: string;

  strategy_label?: string;

  strategy_config?: Partial<import('./SessionConfig').SessionConfig>;

  is_reconciliation?: boolean;

  illiquid_blocked?: boolean;

  _sig_json?: string;

  updated_at?: Date;
}
