export class SessionConfig {
  scan_interval: string = "5m";

  scan_lookback: number = 3;

  scan_pct_threshold: number = 2.0;

  scan_min_volume_usdt?: number = 500000;

  scan_mode?: 'interval' | 'active_window' = 'interval';

  scan_window_duration_sec?: number = 90;

  scan_check_interval_sec?: number = 5;

  watchlist_size: number = 50;

  entry_side?: 'both' | 'long' | 'short' = 'both';

  excluded_symbols?: string[];

  symbols?: string[];

  enabled_signals?: string[] = ['momentum_pct'];

  signal_logic?: 'any' | 'all' = 'all';

  signal_params?: string;

  // Stop Loss Configuration
  sl_type?: 'pct' | 'lookback_low/high' = "pct";

  sl_distance_pct?: number = 0.8;

  sl_lookback_period?: number = 5;

  sl_lookback_timeframe?: string = "5m";

  sl_pct_limit?: number = 1.0;

  sl_min_pct?: number = 0.3;

  sl_max_pct?: number = 3.0;

  tp_mode?: 'fixed' | 'exp_rr_seq' = 'fixed';

  tp_ratio?: number = 2.0;

  // Exponential RR Sequence for Profit Locking
  live_rr_sequence?: number[] = [1.0, 2.0, 4.0];

  exit_rr_sequence?: number[] = [0.0, 1.0, 2.0];

  // Exit Signal Configuration - ANY exit signal fires close
  exit_signals?: string[] = [];

  exit_signal_logic?: 'any' | 'all' = 'any';

  exit_signal_delays?: Record<string, number> = {};

  // Risk Management
  risk_pct_per_trade?: number = 1.0;

  max_open_trades?: number = 5;

  max_open_trades_per_symbol?: number = 1;

  max_trades_per_period?: number = 10;

  trades_period_min?: number = 60;

  max_total_risk_pct?: number = 5.0;

  total_sl_guard_usdt?: number = 200.0;

  // Balance & Mode Configuration
  paper_mode?: boolean = true;

  trading_mode?: 'paper' | 'testnet' | 'live' = 'paper';

  paper_starting_balance?: number = 10000.0;

  live_starting_balance?: number = 10000.0;

  // API & Monitoring
  track_binance_rate_limits?: boolean = true;

  // Schedule & Advanced Risk
  trading_windows?: { start: string; end: string }[] = [];

  risk_use_tod_stats?: boolean = false;

  tod_min_winrate?: number = 40.0;
}
