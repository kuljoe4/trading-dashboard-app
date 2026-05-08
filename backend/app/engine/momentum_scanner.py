from .kline_store import KlineStore
from .ticker_cache import TickerCache
from app.models.session_config import SessionConfig

class MomentumScanner:
    def __init__(self, kline_store: KlineStore, ticker_cache: TickerCache):
        self.kline_store = kline_store
        self.ticker_cache = ticker_cache

    async def scan(self, config: SessionConfig):
        return []
