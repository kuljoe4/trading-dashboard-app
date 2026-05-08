from .ticker_cache import TickerCache
from .order_manager import OrderManager
from app.models.session_config import SessionConfig

class PositionTracker:
    def __init__(self, ticker_cache: TickerCache, order_manager: OrderManager, config: SessionConfig):
        self.ticker_cache = ticker_cache
        self.order_manager = order_manager
        self.config = config
        self.total_sl_used = 0.0
        self._on_close = None
        self._on_tick = None

    def set_callbacks(self, on_close, on_tick):
        self._on_close = on_close
        self._on_tick = on_tick

    async def start(self):
        pass

    async def stop(self):
        pass

    def has_symbol(self, symbol: str):
        return False

    def active_list(self):
        return []

    def total_risk(self):
        return 0.0

    def add_trade(self, trade):
        pass
