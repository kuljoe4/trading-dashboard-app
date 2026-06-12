import { SessionConfig } from '../../models/SessionConfig';

export interface TradeSerializationDto {
  id: string;
  symbol: string;
  strategy_label: string;
  current_price: number;
  sl_price: number;
  tp_price: number | null;
  pnl: number;
  pnl_pct: number;
  realized_fee: number;
  funding_fee?: number;
  rr: number;
  max_rr: number;
  direction: 'LONG' | 'SHORT';
  entry_price: number;
  qty: number;
  paper_mode?: boolean;
  trading_mode?: 'paper' | 'testnet' | 'live';
  exit_signals_status?: Record<string, any>;
  sl_adjustments?: any[];
  live_rr_sequence?: number[];
  exit_rr_sequence?: number[];
  tp_mode?: 'fixed' | 'exp_rr_seq';
  tp_ratio?: number;
  exit_signal_logic?: 'any' | 'all';
  strategy_config?: Partial<SessionConfig>;
  entry_daily_change_pct?: number;
  initial_risk_usdt?: number;
  _delta?: boolean;
  _thin?: boolean;
  _sl_len?: number;
  _sig_json?: string;
}

export interface TickTradeDto {
  id: string;
  symbol: string;
  strategy_label: string;
  current_price: number;
  sl_price: number;
  tp_price: number | null;
  pnl: number;
  pnl_pct?: number;
  realized_fee: number;
  funding_fee?: number;
  rr: number;
  max_rr: number;
  direction: 'LONG' | 'SHORT';
  entry_price: number;
  qty: number;
  entry_daily_change_pct?: number;
  initial_risk_usdt?: number;
  _thin: boolean;
  _sl_len: number;
  _sig_json: string;
  live_rr_sequence?: number[];
  exit_rr_sequence?: number[];
}
