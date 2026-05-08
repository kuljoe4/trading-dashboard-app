from typing import List, Tuple, Optional
from app.models.session_config import SessionConfig
from app.models.trade import Trade

class RiskEngine:
    """Risk management and position sizing."""
    
    def can_enter(
        self, 
        active_trades: List[Trade], 
        balance: float, 
        symbol: str,
        config: SessionConfig, 
        total_sl_used: float
    ) -> Tuple[bool, str]:
        """
        Check if a new trade can be entered based on risk limits.
        
        Args:
            active_trades: List of currently open trades
            balance: Current account balance
            symbol: Trading pair (e.g., "BTCUSDT")
            config: SessionConfig with risk parameters
            total_sl_used: Total SL exposure in USDT across all trades
            
        Returns:
            (can_enter: bool, reason: str)
        """
        # Check global max open trades
        if len(active_trades) >= config.max_open_trades:
            return False, f"Global max open trades ({config.max_open_trades}) reached"
        
        # Check per-symbol max open trades
        symbol_trade_count = sum(1 for t in active_trades if t.symbol == symbol)
        if symbol_trade_count >= config.max_open_trades_per_symbol:
            return False, f"Max open trades for {symbol} ({config.max_open_trades_per_symbol}) reached"
        
        # Check total risk percentage
        total_risk_pct = (total_sl_used / balance) * 100 if balance > 0 else 0
        if total_risk_pct >= config.max_total_risk_pct:
            return False, f"Total risk {total_risk_pct:.2f}% >= max {config.max_total_risk_pct}%"
        
        # Check absolute SL guard in USDT
        if total_sl_used >= config.total_sl_guard_usdt:
            return False, f"Total SL {total_sl_used:.2f} USDT >= guard {config.total_sl_guard_usdt} USDT"
        
        return True, "OK"
    
    def compute_sl(
        self,
        entry_price: float,
        direction: str,  # "LONG" or "SHORT"
        config: SessionConfig,
        lookback_lows: Optional[List[float]] = None,
        lookback_highs: Optional[List[float]] = None
    ) -> float:
        """
        Calculate stop loss price based on SL type configuration.
        
        Args:
            entry_price: Entry price
            direction: "LONG" or "SHORT"
            config: SessionConfig with SL parameters
            lookback_lows: List of low prices for lookback period (if using lookback_low/high)
            lookback_highs: List of high prices for lookback period (if using lookback_low/high)
            
        Returns:
            stop_loss_price: Calculated SL price
        """
        if config.sl_type == "pct":
            # Simple percentage-based SL
            distance = entry_price * (config.sl_distance_pct / 100)
            if direction == "LONG":
                return entry_price - distance
            else:
                return entry_price + distance
        
        elif config.sl_type == "lookback_low/high":
            # SL based on lookback period extremes
            if not lookback_lows or not lookback_highs:
                # Fallback to percentage if lookback data not available
                return self.compute_sl(entry_price, direction, SessionConfig(sl_type="pct"))
            
            if direction == "LONG":
                # For LONG: SL = min(lookback lows) - pct_limit
                min_low = min(lookback_lows)
                distance = abs(min_low - entry_price)
                limit_adjustment = distance * (config.sl_pct_limit / 100)
                return min_low - limit_adjustment
            else:
                # For SHORT: SL = max(lookback highs) + pct_limit
                max_high = max(lookback_highs)
                distance = abs(max_high - entry_price)
                limit_adjustment = distance * (config.sl_pct_limit / 100)
                return max_high + limit_adjustment
        
        else:
            raise ValueError(f"Unknown sl_type: {config.sl_type}")
    
    def compute_position_size(
        self,
        balance: float,
        entry_price: float,
        sl_price: float,
        direction: str,
        config: SessionConfig
    ) -> float:
        """
        Calculate position size (quantity) based on risk parameters.
        
        Formula: qty = (balance × risk_pct_per_trade) / (abs(entry - sl) × entry_price)
        
        Args:
            balance: Current account balance
            entry_price: Entry price
            sl_price: Stop loss price
            direction: "LONG" or "SHORT"
            config: SessionConfig with risk parameters
            
        Returns:
            qty: Position size in contract units
        """
        if balance <= 0 or entry_price <= 0:
            return 0.0
        
        risk_amount = balance * (config.risk_pct_per_trade / 100)
        sl_distance = abs(entry_price - sl_price)
        
        if sl_distance <= 0:
            return 0.0
        
        # qty = risk_amount / (sl_distance)
        # For futures, adjust based on entry_price as well
        qty = risk_amount / sl_distance
        
        return qty
    
    def calculate_risk_reward_ratio(
        self,
        entry_price: float,
        sl_price: float,
        tp_price: float,
        direction: str
    ) -> float:
        """
        Calculate Risk:Reward ratio.
        
        Args:
            entry_price: Entry price
            sl_price: Stop loss price
            tp_price: Take profit price
            direction: "LONG" or "SHORT"
            
        Returns:
            rr_ratio: Risk/Reward ratio (e.g., 1:2 = 2.0)
        """
        risk = abs(entry_price - sl_price)
        reward = abs(tp_price - entry_price)
        
        if risk <= 0:
            return 0.0
        
        return reward / risk
