from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime

class Trade(BaseModel):
    # Core Trade Info
    id: str
    symbol: str
    direction: str  # "LONG" or "SHORT"
    entry_price: float
    qty: float
    entry_ts: datetime = Field(default_factory=datetime.utcnow)
    
    # Stop Loss & Risk Management
    initial_sl: float  # Original SL price at entry
    current_sl: float  # Current SL (may be adjusted by RR sequence)
    
    # Exponential RR Sequence Tracking
    max_rr_achieved: float = 0.0  # Peak R:R since entry (one-way ladder)
    rr_sequence_index: int = -1  # Current milestone index (-1 = no milestone hit yet)
    sl_adjustments: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Audit trail: [{timestamp, prev_sl, new_sl, reason, milestone_index}]"
    )
    
    # Take Profit (fixed at entry, not adjusted)
    tp: float
    
    # Trade State
    pnl: float = 0.0
    status: str = "OPEN"  # "OPEN", "CLOSED", "CLOSED_SL", "CLOSED_TP", "CLOSED_SIGNAL"
    
    # Exit Information
    exit_ts: Optional[datetime] = None
    exit_price: Optional[float] = None
    exit_reason: Optional[str] = None  # "tp_hit", "sl_hit", "exit_signal", "manual", etc.
    exit_signal_type: Optional[str] = None  # Which signal triggered exit (if applicable)
    exit_signal_reason: Optional[str] = None  # Reason from exit signal
    
    # Entry Signal Info (for audit)
    entry_signal_type: Optional[str] = None  # Which signals fired at entry
    entry_signal_confidence: float = 1.0  # Signal confidence (0-1)

    def to_dict(self):
        return self.model_dump()
