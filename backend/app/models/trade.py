from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime

class Trade(BaseModel):
    id: str
    symbol: str
    direction: str  # "LONG" or "SHORT"
    entry_price: float
    qty: float
    sl: float
    tp: float
    pnl: float = 0.0
    status: str = "OPEN"
    entry_ts: datetime = Field(default_factory=datetime.utcnow)
    exit_ts: Optional[datetime] = None
    exit_price: Optional[float] = None
    exit_reason: Optional[str] = None

    def to_dict(self):
        return self.model_dump()
