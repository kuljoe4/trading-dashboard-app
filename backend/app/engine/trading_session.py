import asyncio
import logging
from datetime import datetime
from typing import Optional, Callable
from app.engine.market_feed import MarketFeed
from app.engine.ticker_cache import TickerCache
from app.engine.kline_store import KlineStore
from app.engine.momentum_scanner import MomentumScanner
from app.engine.signal_engine import SignalEngine
from app.engine.risk_engine import RiskEngine
from app.engine.order_manager import OrderManager
from app.engine.position_tracker import PositionTracker
from app.models.session_config import SessionConfig

logger = logging.getLogger(__name__)


class TradingSession:
    """
    Per-user engine container.
    Owns all modules. Orchestrates the scan → signal → risk → order loop.
    
    Supports:
    - Independent paper/live balances
    - Multiple signal types (AND logic)
    - Dynamic SL (percentage or lookback extremes)
    - Exponential RR sequence for profit locking
    - Exit signals for custom close conditions
    - Per-symbol trade limits
    - Binance rate limit tracking
    """

    def __init__(self, user_id: str, strategy_id: str, config: SessionConfig):
        self.user_id = user_id
        self.strategy_id = strategy_id
        self.config = config
        self.started_at = datetime.utcnow()
        self.running = False

        # Separate Paper/Live Balances
        self.balance_paper: float = config.paper_starting_balance
        self.balance_live: float = config.live_starting_balance
        self.total_pnl_paper: float = 0.0
        self.total_pnl_live: float = 0.0
        self.log_lines: list[dict] = []
        self._ws_broadcaster: Optional[Callable] = None
        
        # Binance Rate Limit Tracking
        self.binance_rate_limit = {
            "used_weight": 0,
            "used_weight_1m": 0,
            "limit": 1200,
            "used_pct": 0.0,
            "last_update": None
        }

        # Modules
        self.ticker_cache = TickerCache()
        self.kline_store = KlineStore()
        self.market_feed = MarketFeed(self.ticker_cache, self.kline_store, config)
        self.scanner = MomentumScanner(self.kline_store, self.ticker_cache)
        self.signal_engine = SignalEngine(self.kline_store)
        self.risk_engine = RiskEngine()
        self.order_manager = OrderManager(self.ticker_cache, config)
        self.position_tracker = PositionTracker(
            self.ticker_cache, self.order_manager, config
        )

        # Wire callbacks
        self.order_manager.set_log_callback(self._log)
        self.position_tracker.set_callbacks(
            on_close=self._on_trade_close,
            on_tick=self._on_tracker_tick,
        )
        self.market_feed.set_candle_close_callback(self._on_candle_close)

    def set_ws_broadcaster(self, cb: Callable):
        self._ws_broadcaster = cb
    
    @property
    def balance(self) -> float:
        """Get active balance (paper or live based on config)."""
        return self.balance_paper if self.config.paper_mode else self.balance_live
    
    @property
    def total_pnl(self) -> float:
        """Get active PnL (paper or live based on config)."""
        return self.total_pnl_paper if self.config.paper_mode else self.total_pnl_live

    async def start(self, binance_client=None):
        self.running = True
        
        if binance_client and not self.config.paper_mode:
            self.order_manager.client = binance_client
            # Fetch live balance
            try:
                # Use lighter endpoint: /fapi/v2/balance (1 weight vs 5 for full account)
                balance_data = await binance_client.futures_account_balance()
                for asset in balance_data:
                    if asset["asset"] == "USDT":
                        self.balance_live = float(asset["balance"])
                        break
                await self._log(f"Live balance fetched: ${self.balance_live:.2f}", "info")
            except Exception as e:
                await self._log(f"Live balance fetch failed: {e} — using config default", "warn")

        await self.market_feed.start()
        await self.position_tracker.start()
        await self._log(
            f"Session started | mode={'LIVE' if not self.config.paper_mode else 'PAPER'} | "
            f"signals={','.join(self.config.enabled_signals)} | "
            f"sl_type={self.config.sl_type} | rr_seq={self.config.live_rr_sequence}",
            "info",
        )

    async def stop(self):
        self.running = False
        await self.market_feed.stop()
        await self.position_tracker.stop()
        await self._log("Session stopped", "info")

    def update_config(self, config: SessionConfig):
        self.config = config
        self.market_feed.config = config
        self.order_manager.config = config
        self.position_tracker.config = config

    async def _on_candle_close(self, symbol: str):
        """Triggered on each closed candle from MarketFeed."""
        if not self.running:
            return

        # Run scanner
        opportunities = await self.scanner.scan(self.config)

        # Broadcast scanner results (Top 10)
        await self._broadcast_event("scanner", {
            "opportunities": [
                {
                    "symbol": o.symbol,
                    "pct": o.pct_move,
                    "dir": o.direction,
                    "vol": o.volume_24h,
                    "score": o.score,
                    "price": o.price
                } for o in opportunities[:10]
            ]
        })

        for opp in opportunities:
            # Skip if already in a trade on this symbol
            if self.position_tracker.has_symbol(opp.symbol):
                continue

            # Check entry confirmation - ALL signals must fire (AND logic)
            all_signals_fired, fired_signals, signal_reason = await self.signal_engine.check_entry(
                opp.symbol,
                self.config
            )
            if not all_signals_fired:
                await self._log(f"{opp.symbol}: Signals not confirmed - {signal_reason}", "debug")
                continue

            # Check risk gate with per-symbol limit
            can_enter, gate_reason = self.risk_engine.can_enter(
                active_trades=self.position_tracker.active_list(),
                balance=self.balance,
                symbol=opp.symbol,
                config=self.config,
                total_sl_used=self.position_tracker.total_sl_used,
            )
            if not can_enter:
                await self._log(f"{opp.symbol}: {gate_reason}", "warn")
                continue

            # Get current price
            price = await self.ticker_cache.get_price(opp.symbol)
            if not price:
                await self._log(f"{opp.symbol}: No price available", "warn")
                continue
            
            # Compute SL - support both percentage and lookback types
            sl_price = self.risk_engine.compute_sl(
                entry_price=price,
                direction=opp.direction,
                config=self.config,
                lookback_lows=None,  # TODO: Get from kline_store
                lookback_highs=None   # TODO: Get from kline_store
            )
            
            # Compute position size
            qty = self.risk_engine.compute_position_size(
                balance=self.balance,
                entry_price=price,
                sl_price=sl_price,
                direction=opp.direction,
                config=self.config
            )
            
            if qty <= 0:
                await self._log(f"{opp.symbol}: Position size <= 0", "warn")
                continue
            
            # Calculate TP based on config ratio (fixed at entry, not adjusted)
            rr_ratio = self.config.exit_rr_sequence[0] if self.config.exit_rr_sequence else 1.0
            risk = abs(price - sl_price)
            if opp.direction == "LONG":
                tp_price = price + (risk * rr_ratio)
            else:
                tp_price = price - (risk * rr_ratio)

            # Enter trade
            trade = await self.order_manager.enter(
                strategy_id=self.strategy_id,
                symbol=opp.symbol,
                direction=opp.direction,
                entry_price=price,
                qty=qty,
                sl_price=sl_price,
                tp_price=tp_price
            )
            if trade:
                trade.entry_signal_type = ",".join(fired_signals)
                self.position_tracker.add_trade(trade)
                await self._log(
                    f"Entry: {opp.symbol} {opp.direction} @ {price} | "
                    f"SL={sl_price:.2f} TP={tp_price:.2f} | qty={qty:.4f}",
                    "info"
                )
                await self._broadcast_event("trade_event", {
                    "event": "entry",
                    "trade": trade.to_dict(),
                })

    async def _on_trade_close(self, closed: dict):
        pnl = closed.get("pnl", 0)
        if self.config.paper_mode:
            self.total_pnl_paper += pnl
        else:
            self.total_pnl_live += pnl
        
        await self._broadcast_event("trade_event", {
            "event": closed.get("exit_reason", "close"),
            "trade": closed,
        })

    async def _on_tracker_tick(self):
        await self._broadcast_tick()

    async def _log(self, msg: str, level: str = "info"):
        entry = {
            "ts": datetime.utcnow().strftime("%H:%M:%S"),
            "level": level,
            "msg": msg,
        }
        self.log_lines.insert(0, entry)
        if len(self.log_lines) > 200:
            self.log_lines = self.log_lines[:200]
        await self._broadcast_event("log", entry)

    async def _broadcast_tick(self):
        await self._broadcast_event("tick", {
            "balance_paper": round(self.balance_paper, 2),
            "balance_live": round(self.balance_live, 2),
            "balance": round(self.balance, 2),  # Active balance
            "total_pnl": round(self.total_pnl, 2),
            "total_risk_pct": round(
                (self.position_tracker.total_risk() / self.balance * 100)
                if self.balance > 0 else 0, 2
            ),
            "total_sl_used": round(self.position_tracker.total_sl_used, 2),
            "trades": self.position_tracker.active_list(),
            "rate_limit": self.binance_rate_limit,
        })

    async def _broadcast_event(self, event_type: str, payload: dict):
        if self._ws_broadcaster:
            try:
                await self._ws_broadcaster({"type": event_type, **payload})
            except Exception:
                pass

    def get_status(self) -> dict:
        return {
            "user_id": self.user_id,
            "strategy_id": self.strategy_id,
            "running": self.running,
            "paper_mode": self.config.paper_mode,
            "balance_paper": round(self.balance_paper, 2),
            "balance_live": round(self.balance_live, 2),
            "balance": round(self.balance, 2),
            "total_pnl": round(self.total_pnl, 2),
            "total_risk_pct": round(
                (self.position_tracker.total_risk() / self.balance * 100)
                if self.balance > 0 else 0, 2
            ),
            "total_sl_used": round(self.position_tracker.total_sl_used, 2),
            "active_trades": self.position_tracker.active_list(),
            "config": self.config.model_dump(),
            "started_at": self.started_at.isoformat(),
            "rate_limit": self.binance_rate_limit,
        }
