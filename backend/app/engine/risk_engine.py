from typing import List
from app.models.session_config import SessionConfig

class RiskEngine:
    def can_enter(self, active_trades: List, balance: float, config: SessionConfig, total_sl_used: float):
        return True, ""

    def compute(self, balance: float, entry_price: float, direction: str, config: SessionConfig):
        class Sizing:
            qty = 0.0
        return Sizing()
