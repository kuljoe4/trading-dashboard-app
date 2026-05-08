from typing import List

class KlineStore:
    def __init__(self):
        self._klines = {}

    async def upsert_candle(self, symbol: str, interval: str, kline: dict):
        pass

    async def seed_from_rest(self, symbol: str, interval: str, klines: List[list]):
        pass
