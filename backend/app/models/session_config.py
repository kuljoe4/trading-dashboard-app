from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class SessionConfig(BaseModel):
    # Scanner Configuration
    scan_interval: str = "5m"
    scan_lookback: int = 3
    scan_pct_threshold: float = 2.0
    watchlist_size: int = 50
    excluded_symbols: List[str] = Field(default_factory=list)
    symbols: Optional[List[str]] = None
    
    # Signal Configuration - ALL signals must fire for entry (AND logic)
    enabled_signals: List[str] = Field(default_factory=lambda: ["engulfing"], description="List of signal types: engulfing, ma, ema")
    signal_params: Dict[str, Any] = Field(default_factory=dict, description="Signal-specific params (e.g., ma_period, ema_period)")
    
    # Stop Loss Configuration
    sl_type: str = "pct"  # "pct" or "lookback_low/high"
    sl_distance_pct: float = 0.8  # Used when sl_type is "pct"
    sl_lookback_period: int = 5  # Used when sl_type is "lookback_low/high"
    sl_lookback_timeframe: str = "5m"  # Timeframe for lookback (e.g., "1m", "5m", "15m")
    sl_pct_limit: float = 1.0  # Hard ceiling: max % adjustment from lookback extreme
    
    # Exponential RR Sequence for Profit Locking
    live_rr_sequence: List[float] = Field(default_factory=lambda: [1.0, 2.0], description="RR milestones to trigger SL adjustments")
    exit_rr_sequence: List[float] = Field(default_factory=lambda: [0.0, 1.0], description="Target RR for SL at each milestone")
    
    # Exit Signal Configuration - ANY exit signal fires close
    exit_signals: List[str] = Field(default_factory=list, description="Signals that trigger exit (opposite logic from entry)")
    
    # Risk Management
    risk_pct_per_trade: float = 1.0
    max_open_trades: int = 5  # Global limit
    max_open_trades_per_symbol: int = 1  # Per-symbol limit
    max_total_risk_pct: float = 5.0
    total_sl_guard_usdt: float = 200.0
    
    # Balance & Mode Configuration
    paper_mode: bool = True
    paper_starting_balance: float = 10000.0  # Independent paper balance
    live_starting_balance: float = 10000.0   # Independent live balance
    
    # API & Monitoring
    track_binance_rate_limits: bool = True  # Display rate limit stats
