from .ticker_cache import TickerCache
from app.models.session_config import SessionConfig
from app.models.trade import Trade
from typing import Optional, Tuple
import uuid
from datetime import datetime

class OrderManager:
    """
    Manages order placement, tracking, and exit signal logic.
    """
    
    def __init__(self, ticker_cache: TickerCache, config: SessionConfig):
        self.ticker_cache = ticker_cache
        self.config = config
        self.client = None
        self._log_cb = None
    
    def set_log_callback(self, cb):
        self._log_cb = cb
    
    async def enter(
        self,
        strategy_id: str,
        symbol: str,
        direction: str,
        entry_price: float,
        qty: float,
        sl_price: float,
        tp_price: float
    ) -> Optional[Trade]:
        """
        Create new trade entry.
        
        Args:
            strategy_id: Strategy identifier
            symbol: Trading pair
            direction: "LONG" or "SHORT"
            entry_price: Entry price
            qty: Position size
            sl_price: Stop loss price
            tp_price: Take profit price
            
        Returns:
            Trade object or None if failed
        """
        try:
            trade = Trade(
                id=str(uuid.uuid4()),
                symbol=symbol,
                direction=direction,
                entry_price=entry_price,
                qty=qty,
                initial_sl=sl_price,
                current_sl=sl_price,
                tp=tp_price,
                entry_ts=datetime.utcnow(),
                max_rr_achieved=0.0,
                rr_sequence_index=-1
            )
            
            self._log(f"Enter: {symbol} {direction} @ {entry_price} qty={qty} SL={sl_price} TP={tp_price}")
            return trade
            
        except Exception as e:
            self._log(f"Enter failed: {str(e)}")
            return None
    
    async def check_exit_signals(
        self,
        symbol: str,
        trade: Trade,
        signal_engine,
        direction: str
    ) -> Tuple[bool, Optional[str]]:
        """
        Check if exit signals fire.
        
        Exit signals are triggered when configured exit_signals fire.
        ANY exit signal firing closes the position.
        
        Args:
            symbol: Trading pair
            trade: Current Trade object
            signal_engine: SignalEngine instance to check signals
            direction: Entry direction ("LONG" or "SHORT")
            
        Returns:
            (exit_triggered: bool, exit_signal_type: Optional[str])
        """
        if not self.config.exit_signals:
            return False, None
        
        # Check each configured exit signal
        for exit_signal in self.config.exit_signals:
            signal_fired = await self._check_signal(symbol, exit_signal)
            
            if signal_fired:
                self._log(f"Exit signal {exit_signal} fired for {symbol}")
                return True, exit_signal
        
        return False, None
    
    async def _check_signal(self, symbol: str, signal_type: str) -> bool:
        """
        Check if a specific exit signal fires.
        
        Exit signals use opposite logic:
        - If entry was ENGULFING (bullish), exit on reverse ENGULFING (bearish)
        - If entry was MA cross up, exit on MA cross down
        - etc.
        """
        # TODO: Integrate with SignalEngine for reverse signal checking
        # This is a placeholder - will be implemented when signals are fully wired
        return False
    
    def _log(self, msg: str):
        """Log message via callback."""
        if self._log_cb:
            self._log_cb(msg)
