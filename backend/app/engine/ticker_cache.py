from typing import List, Optional

class TickerCache:
    def __init__(self):
        self._tickers = {}

    async def bulk_update(self, tickers: List[dict]):
        for t in tickers:
            symbol = t.get("s")
            if symbol:
                self._tickers[symbol] = t

    async def get_price(self, symbol: str) -> Optional[float]:
        ticker = self._tickers.get(symbol)
        if ticker:
            return float(ticker.get("c", 0))
        return None

    async def top_by_volume(self, n: int, excluded: List[str]):
        # Mocking top volume symbols
        return []
