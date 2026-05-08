from pydantic import BaseModel, Field
from typing import List, Optional

class SessionConfig(BaseModel):
    scan_interval: str = "5m"
    scan_lookback: int = 3
    scan_pct_threshold: float = 2.0
    sl_distance_pct: float = 0.8
    risk_pct_per_trade: float = 1.0
    tp_ratio: float = 2.0
    max_open_trades: int = 5
    max_total_risk_pct: float = 5.0
    total_sl_guard_usdt: float = 200.0
    paper_mode: bool = True
    watchlist_size: int = 50
    excluded_symbols: List[str] = Field(default_factory=list)
    symbols: Optional[List[str]] = None
