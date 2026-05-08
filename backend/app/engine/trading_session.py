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
    """

    def __init__(self, user_id: str, strategy_id: str, config: SessionConfig):
        self.user_id = user_id
        self.strategy_id = strategy_id
        self.config = config
        self.started_at = datetime.utcnow()
        self.running = False

        # State
        self.balance: float = 10_000.0  # Updated from exchange on start
        self.total_pnl: float = 0.0
        self.log_lines: list[dict] = []
        self._ws_broadcaster: Optional[Callable] = None

        # Modules
        self.ticker_cache = TickerCache()
        self.kline_store = KlineStore()
        self.market_feed = MarketFeed(self.ticker_cache, self.kline_store, config)
        self.scanner = MomentumScanner(self.kline_store, self.ticker_cache)
        self.signal_engine = SignalEngine()
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

    async def start(self, binance_client=None):
        self.running = True
        if binance_client:
            self.order_manager.client = binance_client
            # Fetch live balance
            try:
                account = await binance_client.futures_account_balance()
                for asset in account:
                    if asset["asset"] == "USDT":
                        self.balance = float(asset["balance"])
                        break
            except Exception as e:
                await self._log(f"Balance fetch failed: {e} — using $10,000", "warn")

        await self.market_feed.start()
        await self.position_tracker.start()
        await self._log(
            f"Session started | paper={self.config.paper_mode} | "
            f"threshold={self.config.scan_pct_threshold}% / {self.config.scan_interval}",
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

            # Check entry confirmation
            confirmed, reason = self.signal_engine.check_entry(opp, self.config)
            if not confirmed:
                continue

            # Check risk gate
            can_enter, gate_reason = self.risk_engine.can_enter(
                active_trades=self.position_tracker.active_list(),
                balance=self.balance,
                config=self.config,
                total_sl_used=self.position_tracker.total_sl_used,
            )
            if not can_enter:
                await self._log(f"Risk gate: {gate_reason}", "warn")
                continue

            # Compute size
            price = await self.ticker_cache.get_price(opp.symbol)
            if not price:
                continue
            sizing = self.risk_engine.compute(
                balance=self.balance,
                entry_price=price,
                direction=opp.direction,
                config=self.config,
            )
            if sizing.qty <= 0:
                continue

            # Enter
            trade = await self.order_manager.enter(
                strategy_id=self.strategy_id,
                symbol=opp.symbol,
                direction=opp.direction,
                sizing=sizing,
            )
            if trade:
                self.position_tracker.add_trade(trade)
                await self._broadcast_event("trade_event", {
                    "event": "entry",
                    "trade": trade.to_dict(),
                })

    async def _on_trade_close(self, closed: dict):
        pnl = closed.get("pnl", 0)
        self.total_pnl += pnl
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
            "balance": round(self.balance, 2),
            "total_pnl": round(self.total_pnl, 2),
            "total_risk_pct": round(
                (self.position_tracker.total_risk() / self.balance * 100)
                if self.balance > 0 else 0, 2
            ),
            "total_sl_used": round(self.position_tracker.total_sl_used, 2),
            "trades": self.position_tracker.active_list(),
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
        }
