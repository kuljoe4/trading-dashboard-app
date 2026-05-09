export class SessionConfig {
  scan_interval: string = "5m";

  scan_lookback: number = 3;

  scan_pct_threshold: number = 2.0;

  watchlist_size: number = 50;

  excluded_symbols?: string[];

  symbols?: string[];

  enabled_signals?: string[];

  signal_params?: string;

  // Stop Loss Configuration
  sl_type?: string = "pct";

  sl_distance_pct?: number = 0.8;

  sl_lookback_period?: number = 5;

  sl_lookback_timeframe?: string = "5m";

  sl_pct_limit?: number = 1.0;

  // Exponential RR Sequence for Profit Locking
  live_rr_sequence?: number[] = [1.0, 2.0];

  exit_rr_sequence?: number[] = [0.0, 1.0];

  // Exit Signal Configuration - ANY exit signal fires close
  exit_signals?: string[] = [];

  // Risk Management
  risk_pct_per_trade?: number = 1.0;

  max_open_trades?: number = 5;

  max_open_trades_per_symbol?: number = 1;

  max_total_risk_pct?: number = 5.0;

  total_sl_guard_usdt?: number = 200.0;

  // Balance & Mode Configuration
  paper_mode?: boolean = true;

  paper_starting_balance?: number = 10000.0;

  live_starting_balance?: number = 10000.0;

  // API & Monitoring
  track_binance_rate_limits?: boolean = true;
}