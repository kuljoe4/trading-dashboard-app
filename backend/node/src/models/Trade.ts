export class Trade {
  id: string = '';

  symbol: string = '';

  direction: 'LONG' | 'SHORT' = 'LONG';

  entry_price: number = 0;

  qty: number = 0;

  initial_sl: number = 0;

  current_sl: number = 0;

  max_rr_achieved: number = 0;

  rr_sequence_index: number = 0;

  entry_ts?: Date;

  tp: number = 0;

  pnl: number = 0;

  status: 'OPEN' | 'CLOSED' | 'CLOSED_SL' | 'CLOSED_TP' | 'CLOSED_SIGNAL' = 'OPEN';

  exit_ts?: Date;

  exit_price?: number;

  exit_reason?: string;

  exit_signal_type?: string;

  exit_signal_reason?: string;

  entry_signal_type?: string;

  entry_signal_confidence = 0;

  sl_adjustments?: {
    timestamp: string;
    prev_sl: number;
    new_sl: number;
    reason: string;
    milestone_index: number;
    max_rr_achieved?: number;
  }[];

  pnl_pct?: number;

  quantity?: number;

  binance_order_id?: string;

  binance_close_order_id?: string;
}
