from app.models.session_config import SessionConfig
from typing import Tuple, List, Dict, Optional
from .kline_store import KlineStore

class SignalEngine:
    """
    Implements multiple signal types for entry conditions.
    ALL enabled signals must fire for entry (AND logic).
    """
    
    def __init__(self, kline_store: KlineStore):
        self.kline_store = kline_store
    
    async def check_entry(self, symbol: str, config: SessionConfig) -> Tuple[bool, List[str], str]:
        """
        Check if ALL enabled signals fire for entry.
        
        Args:
            symbol: Trading pair (e.g., "BTCUSDT")
            config: SessionConfig with enabled_signals list
            
        Returns:
            (all_signals_fired: bool, fired_signals: List[str], reason: str)
        """
        if not config.enabled_signals:
            return False, [], "No signals enabled"
        
        fired_signals = []
        failed_signals = []
        
        for signal_type in config.enabled_signals:
            if signal_type == "engulfing":
                fired = await self._engulfing_signal(symbol, config)
                if fired:
                    fired_signals.append("engulfing")
                else:
                    failed_signals.append("engulfing")
                    
            elif signal_type == "ma":
                fired = await self._ma_signal(symbol, config)
                if fired:
                    fired_signals.append("ma")
                else:
                    failed_signals.append("ma")
                    
            elif signal_type == "ema":
                fired = await self._ema_signal(symbol, config)
                if fired:
                    fired_signals.append("ema")
                else:
                    failed_signals.append("ema")
        
        # ALL signals must fire (AND logic)
        all_fired = len(fired_signals) == len(config.enabled_signals)
        
        reason = f"Signals fired: {', '.join(fired_signals)}"
        if failed_signals:
            reason += f"; Failed: {', '.join(failed_signals)}"
        
        return all_fired, fired_signals, reason
    
    async def _engulfing_signal(self, symbol: str, config: SessionConfig) -> bool:
        """
        Engulfing Pattern: Current candle engulfs the previous candle.
        - High of current > high of previous
        - Low of current < low of previous
        """
        candles = await self._get_candles(symbol, config.scan_interval, 2)
        if len(candles) < 2:
            return False
        
        prev_candle = candles[-2]
        curr_candle = candles[-1]
        
        prev_high = float(prev_candle[2])
        prev_low = float(prev_candle[3])
        curr_high = float(curr_candle[2])
        curr_low = float(curr_candle[3])
        
        return curr_high > prev_high and curr_low < prev_low
    
    async def _ma_signal(self, symbol: str, config: SessionConfig) -> bool:
        """
        Moving Average Signal: Price crosses above/below MA.
        Default: 20-period MA on close
        """
        period = config.signal_params.get("ma_period", 20)
        candles = await self._get_candles(symbol, config.scan_interval, period + 1)
        
        if len(candles) < period + 1:
            return False
        
        # Calculate SMA
        closes = [float(c[4]) for c in candles]  # Close prices
        ma = sum(closes[-period:]) / period
        curr_close = closes[-1]
        prev_close = closes[-2]
        
        # Signal if price crossed above MA
        return prev_close <= ma < curr_close or prev_close >= ma > curr_close
    
    async def _ema_signal(self, symbol: str, config: SessionConfig) -> bool:
        """
        Exponential Moving Average Signal: Price crosses above/below EMA.
        Default: 12-period EMA on close
        """
        period = config.signal_params.get("ema_period", 12)
        candles = await self._get_candles(symbol, config.scan_interval, period + 1)
        
        if len(candles) < period + 1:
            return False
        
        closes = [float(c[4]) for c in candles]
        ema = self._calculate_ema(closes[:-1], period)
        curr_close = closes[-1]
        
        # Signal if price crossed above/below EMA
        prev_close = closes[-2]
        return prev_close <= ema < curr_close or prev_close >= ema > curr_close
    
    async def _get_candles(self, symbol: str, interval: str, count: int) -> List[list]:
        """Get last N candles for symbol at interval."""
        # TODO: Integrate with KlineStore once it's fully implemented
        # For now, return empty (will be populated by market_feed)
        return []
    
    def _calculate_ema(self, prices: List[float], period: int) -> float:
        """Calculate EMA for a list of prices."""
        if len(prices) < period:
            return sum(prices) / len(prices)
        
        multiplier = 2 / (period + 1)
        ema = sum(prices[-period:]) / period  # SMA for first value
        
        for price in prices[-period+1:]:
            ema = price * multiplier + ema * (1 - multiplier)
        
        return ema
