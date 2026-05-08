import asyncio
import json
import logging
from typing import Callable, Optional
import websockets
from app.engine.ticker_cache import TickerCache
from app.engine.kline_store import KlineStore
from app.models.session_config import SessionConfig
from app.core.config import settings

logger = logging.getLogger(__name__)

BINANCE_WS_BASE = (
    "wss://fstream.binance.com"
    if not settings.BINANCE_TESTNET
    else "wss://stream.binancefuture.com"
)
BINANCE_REST_BASE = (
    "https://fapi.binance.com"
    if not settings.BINANCE_TESTNET
    else "https://testnet.binancefuture.com"
)


class MarketFeed:
    """
    Manages all WebSocket connections:
    - !miniTicker@arr     → TickerCache (all symbols, ~1s)
    - <sym>@kline_<tf>   → KlineStore (subscribed watchlist)
    
    Streams are managed as independent asyncio Tasks.
    REST is used ONLY for initial kline backfill (once per symbol).
    """

    def __init__(
        self,
        ticker_cache: TickerCache,
        kline_store: KlineStore,
        config: SessionConfig,
    ):
        self.ticker_cache = ticker_cache
        self.kline_store = kline_store
        self.config = config
        self._tasks: list[asyncio.Task] = []
        self._running = False
        self._subscribed_klines: set[str] = set()
        self._on_candle_close: Optional[Callable] = None
        self._watchlist_lock = asyncio.Lock()

    def set_candle_close_callback(self, cb: Callable):
        self._on_candle_close = cb

    async def start(self):
        self._running = True
        self._tasks.append(asyncio.create_task(self._run_mini_ticker()))
        self._tasks.append(asyncio.create_task(self._watchlist_manager()))
        logger.info("MarketFeed started")

    async def stop(self):
        self._running = False
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
        logger.info("MarketFeed stopped")

    async def subscribe_symbol(self, symbol: str):
        """Subscribe kline stream for a symbol (idempotent)."""
        key = f"{symbol}_{self.config.scan_interval}"
        async with self._watchlist_lock:
            if key in self._subscribed_klines:
                return
            self._subscribed_klines.add(key)

        # Backfill from REST first
        await self._backfill_klines(symbol)
        # Start WS stream
        task = asyncio.create_task(self._run_kline_stream(symbol))
        self._tasks.append(task)

    async def _run_mini_ticker(self):
        """!miniTicker@arr — all symbols, every ~1s."""
        url = f"{BINANCE_WS_BASE}/stream?streams=!miniTicker@arr"
        backoff = 1
        while self._running:
            try:
                async with websockets.connect(url, ping_interval=20, ping_timeout=30) as ws:
                    logger.info("miniTicker stream connected")
                    backoff = 1
                    async for msg in ws:
                        if not self._running:
                            break
                        data = json.loads(msg)
                        tickers = data.get("data", [])
                        if tickers:
                            await self.ticker_cache.bulk_update(tickers)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"miniTicker WS error: {e}, reconnecting in {backoff}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    async def _run_kline_stream(self, symbol: str):
        """<symbol>@kline_<interval> stream."""
        interval = self.config.scan_interval
        stream = f"{symbol.lower()}@kline_{interval}"
        url = f"{BINANCE_WS_BASE}/stream?streams={stream}"
        backoff = 1
        while self._running:
            try:
                async with websockets.connect(url, ping_interval=20, ping_timeout=30) as ws:
                    logger.info(f"Kline stream connected: {stream}")
                    backoff = 1
                    async for msg in ws:
                        if not self._running:
                            break
                        data = json.loads(msg)
                        kline = data.get("data", {}).get("k", {})
                        if kline:
                            await self.kline_store.upsert_candle(symbol, interval, kline)
                            if kline.get("x") and self._on_candle_close:
                                asyncio.create_task(self._on_candle_close(symbol))
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"Kline WS {stream} error: {e}, reconnecting in {backoff}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    async def _backfill_klines(self, symbol: str):
        """Fetch historical klines via REST. Called ONCE per symbol."""
        import httpx
        url = f"{BINANCE_REST_BASE}/fapi/v1/klines"
        params = {
            "symbol": symbol,
            "interval": self.config.scan_interval,
            "limit": 100,
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(url, params=params)
                klines = resp.json()
                if isinstance(klines, list):
                    await self.kline_store.seed_from_rest(
                        symbol, self.config.scan_interval, klines
                    )
                    logger.info(f"Backfilled {len(klines)} candles for {symbol}")
        except Exception as e:
            logger.warning(f"Backfill failed for {symbol}: {e}")

    async def _watchlist_manager(self):
        """
        Every 60s: pick top N symbols by 24h volume from TickerCache
        and subscribe their kline streams if not already subscribed.
        """
        await asyncio.sleep(5)  # Let miniTicker populate first
        while self._running:
            top = await self.ticker_cache.top_by_volume(
                n=self.config.watchlist_size,
                excluded=self.config.excluded_symbols,
            )
            # If user specified a watchlist, use that instead
            if self.config.symbols:
                watchlist = self.config.symbols
            else:
                watchlist = [t.symbol for t in top]

            for sym in watchlist:
                await self.subscribe_symbol(sym)

            await asyncio.sleep(60)
