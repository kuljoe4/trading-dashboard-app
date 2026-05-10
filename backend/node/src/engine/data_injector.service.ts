import { Injectable, OnModuleInit } from '@nestjs/common';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService } from './kline_store.service';
import { MomentumScannerService } from './momentum_scanner.service';

@Injectable()
export class DataInjectorService implements OnModuleInit {
  constructor(
    private tickerCache: TickerCacheService,
    private klineStore: KlineStoreService,
    private scanner: MomentumScannerService,
  ) {}

  async onModuleInit() {
    setTimeout(async () => {
      console.log('Injecting sample data...');
      
      await this.tickerCache.bulkUpdate([{ s: 'BTCUSDT', c: '66000', v: '1000' }]);
      await this.klineStore.upsertCandle('BTCUSDT', '5m', {
        t: Date.now() - 300000, o: '60000', c: '60500', h: '61000', l: '60000', v: '100', x: true
      });
      await this.klineStore.upsertCandle('BTCUSDT', '5m', {
        t: Date.now(), o: '60500', c: '66000', h: '66500', l: '60500', v: '100', x: true
      });

      console.log('Sample data injected.');
      
      const results = await this.scanner.scan({
        symbols: ['BTCUSDT'],
        scan_interval: '5m',
        watchlist_size: 10,
        scan_pct_threshold: 0.1,
        scan_lookback: 1,
      } as any);
      
      console.log('Scanner results (count):', results.length);
      if (results.length > 0) {
        console.log('First result:', JSON.stringify(results[0]));
      }
    }, 10000); // 10s wait
  }
}
