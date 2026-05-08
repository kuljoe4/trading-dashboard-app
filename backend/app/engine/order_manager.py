from .ticker_cache import TickerCache
from app.models.session_config import SessionConfig

class OrderManager:
    def __init__(self, ticker_cache: TickerCache, config: SessionConfig):
        self.ticker_cache = ticker_cache
        self.config = config
        self.client = None
        self._log_cb = None

    def set_log_callback(self, cb):
        self._log_cb = cb

    async def enter(self, strategy_id: str, symbol: str, direction: str, sizing):
        return None
