from .ticker_cache import TickerCache
from .order_manager import OrderManager
from app.models.session_config import SessionConfig
from app.models.trade import Trade
from typing import List, Dict, Optional
from datetime import datetime

class PositionTracker:
    """
    Tracks open trades and manages:
    - Trade lifecycle (entry, updates, exit)
    - Exponential RR Sequence for profit locking
    - Risk calculations
    """
    
    def __init__(self, ticker_cache: TickerCache, order_manager: OrderManager, config: SessionConfig):
        self.ticker_cache = ticker_cache
        self.order_manager = order_manager
        self.config = config
        self.total_sl_used = 0.0
        self._on_close = None
        self._on_tick = None
        self._trades: Dict[str, Trade] = {}  # symbol -> Trade
    
    def set_callbacks(self, on_close, on_tick):
        self._on_close = on_close
        self._on_tick = on_tick
    
    async def start(self):
        """Start monitoring trades."""
        pass
    
    async def stop(self):
        """Stop monitoring trades."""
        pass
    
    def has_symbol(self, symbol: str) -> bool:
        """Check if symbol has open trade."""
        return symbol in self._trades
    
    def active_list(self) -> List[Trade]:
        """Return list of active trades."""
        return list(self._trades.values())
    
    def total_risk(self) -> float:
        """Calculate total risk exposure in USDT."""
        return sum(abs(t.entry_price - t.current_sl) * t.qty for t in self._trades.values())
    
    def add_trade(self, trade: Trade) -> None:
        """Add new trade to tracking."""
        self._trades[trade.symbol] = trade
        self.total_sl_used = self.total_risk()
    
    async def check_rr_sequence_adjustments(self, symbol: str, current_price: float) -> None:
        """
        Check and apply Exponential RR Sequence adjustments.
        
        This implements the "Profit Bodyguard" - ratcheting SL as trade reaches profit milestones:
        - Calculates current live RR
        - Updates peak RR (one-way ladder, never goes down)
        - When max_rr crosses a milestone, moves SL to corresponding exit_rr target
        
        Args:
            symbol: Trading pair
            current_price: Current market price
        """
        if symbol not in self._trades:
            return
        
        trade = self._trades[symbol]
        if trade.status != "OPEN":
            return
        
        # Calculate current R:R metrics
        risk = abs(trade.entry_price - trade.initial_sl)
        if risk <= 0:
            return
        
        reward = abs(current_price - trade.entry_price)
        live_rr = reward / risk
        
        # Update peak R:R (one-way ladder, never goes down)
        prev_max_rr = trade.max_rr_achieved
        trade.max_rr_achieved = max(prev_max_rr, live_rr)
        
        # Find highest milestone crossed by max_rr
        current_index = -1
        for i, threshold in enumerate(self.config.live_rr_sequence):
            if trade.max_rr_achieved >= threshold:
                current_index = i
        
        # If we crossed a new milestone, update SL
        if current_index > trade.rr_sequence_index and current_index >= 0:
            old_rr_index = trade.rr_sequence_index
            trade.rr_sequence_index = current_index
            
            # Get target RR for this milestone
            exit_rr = self.config.exit_rr_sequence[current_index]
            
            # Calculate new SL based on target RR
            prev_sl = trade.current_sl
            if trade.direction == "LONG":
                # For LONG: new_sl = entry - (risk × exit_rr)
                new_sl = trade.entry_price - (risk * exit_rr)
            else:
                # For SHORT: new_sl = entry + (risk × exit_rr)
                new_sl = trade.entry_price + (risk * exit_rr)
            
            # Only move SL deeper into profit (stricter protection)
            if trade.direction == "LONG" and new_sl > prev_sl:
                trade.current_sl = new_sl
                self._log_sl_adjustment(trade, prev_sl, new_sl, current_index)
            elif trade.direction == "SHORT" and new_sl < prev_sl:
                trade.current_sl = new_sl
                self._log_sl_adjustment(trade, prev_sl, new_sl, current_index)
            
            # Update total risk
            self.total_sl_used = self.total_risk()
    
    def _log_sl_adjustment(self, trade: Trade, prev_sl: float, new_sl: float, milestone_index: int) -> None:
        """Log SL adjustment to audit trail."""
        adjustment = {
            "timestamp": datetime.utcnow().isoformat(),
            "prev_sl": prev_sl,
            "new_sl": new_sl,
            "reason": f"RR_sequence_milestone_{milestone_index}",
            "milestone_index": milestone_index,
            "max_rr_achieved": trade.max_rr_achieved
        }
        trade.sl_adjustments.append(adjustment)
    
    async def check_exit_conditions(self, symbol: str, current_price: float) -> Optional[tuple]:
        """
        Check if trade should be exited (SL hit, TP hit, exit signal).
        
        Returns:
            (exit_occurred: bool, exit_type: str, exit_reason: str) or None
        """
        if symbol not in self._trades:
            return None
        
        trade = self._trades[symbol]
        if trade.status != "OPEN":
            return None
        
        # Check SL hit
        if trade.direction == "LONG" and current_price <= trade.current_sl:
            return self._close_trade(trade, current_price, "CLOSED_SL", "sl_hit")
        
        # Check TP hit
        if trade.direction == "SHORT" and current_price >= trade.current_sl:
            return self._close_trade(trade, current_price, "CLOSED_SL", "sl_hit")
        
        # Check TP hit
        if trade.direction == "LONG" and current_price >= trade.tp:
            return self._close_trade(trade, current_price, "CLOSED_TP", "tp_hit")
        
        if trade.direction == "SHORT" and current_price <= trade.tp:
            return self._close_trade(trade, current_price, "CLOSED_TP", "tp_hit")
        
        return None
    
    def _close_trade(self, trade: Trade, exit_price: float, status: str, reason: str) -> tuple:
        """Close a trade and update status."""
        trade.exit_price = exit_price
        trade.status = status
        trade.exit_reason = reason
        trade.exit_ts = datetime.utcnow()
        
        # Calculate PnL
        if trade.direction == "LONG":
            trade.pnl = (exit_price - trade.entry_price) * trade.qty
        else:
            trade.pnl = (trade.entry_price - exit_price) * trade.qty
        
        return (True, status, reason)
    
    def close_trade_by_signal(self, symbol: str, signal_type: str, reason: str) -> bool:
        """Close trade triggered by exit signal."""
        if symbol not in self._trades:
            return False
        
        trade = self._trades[symbol]
        if trade.status != "OPEN":
            return False
        
        # Get current price from ticker cache
        ticker_info = self.ticker_cache._tickers.get(symbol, {})
        current_price = float(ticker_info.get("lastPrice", trade.entry_price))
        
        trade.exit_signal_type = signal_type
        trade.exit_signal_reason = reason
        self._close_trade(trade, current_price, "CLOSED_SIGNAL", "exit_signal")
        
        self.total_sl_used = self.total_risk()
        return True
    
    def remove_trade(self, symbol: str) -> None:
        """Remove closed trade from tracking."""
        if symbol in self._trades:
            del self._trades[symbol]
        self.total_sl_used = self.total_risk()
