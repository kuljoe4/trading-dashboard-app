import { Injectable, Logger } from '@nestjs/common';
import { MarketFeedService } from './market_feed.service';
import { TickerCacheService } from './ticker_cache.service';
import { SessionStateService } from './session_state.service';
import { roundEight, floorStep } from '../lib/math';
import { CONFIG_LIMITS, ENGINE_CONSTANTS } from '../models/constants';
import { BinancePositionV3 } from '../models/binance.types';
import { BinanceRequestQueue } from '../lib/binanceClientFactory';

@Injectable()
export class OrderFilterService {
  private readonly logger = new Logger(OrderFilterService.name);
  private leverageBrackets: Map<string, any> = new Map();
  private lastBracketFetch = 0;

  constructor(
    private readonly marketFeed: MarketFeedService,
    private readonly tickerCache: TickerCacheService,
    private readonly sessionState: SessionStateService,
  ) {}

  public applyFilters(
    symbol: string,
    price: number,
    qty: number,
    options: {
      priceRounding?: 'round' | 'floor' | 'ceil',
      skipNotionalCheck?: boolean,
      clampToPercentPrice?: boolean,
      cachedFilters?: any,
      paperMode?: boolean
    } = {}
  ) {
    const filters = options.cachedFilters || this.marketFeed.getSymbolFilters(symbol);
    if (!filters) return { price, qty };

    let finalPrice = price;
    let finalQty = qty;

    const tickSize = filters.tickSize;
    if (tickSize > 0) {
      const rounding = options.priceRounding || 'round';
      const epsilon = 1e-10;
      if (rounding === 'floor') finalPrice = roundEight(Math.floor((price + epsilon) / tickSize) * tickSize);
      else if (rounding === 'ceil') finalPrice = roundEight(Math.ceil((price - epsilon) / tickSize) * tickSize);
      else finalPrice = roundEight(Math.round(price / tickSize) * tickSize);
    }

    // PERCENT_PRICE Validation & Clamping
    if (filters.multiplierUp && !options.paperMode) {
      const ticker = this.tickerCache.getTicker(symbol);
      const markPrice = ticker?.mark_price || ticker?.price;
      if (markPrice) {
        const maxPrice = markPrice * filters.multiplierUp;
        const minPrice = markPrice * filters.multiplierDown;

        const safetyBuffer = 0.005;
        const bufferedMax = maxPrice * (1 - safetyBuffer);
        const bufferedMin = minPrice * (1 + safetyBuffer);

        if (finalPrice > bufferedMax || finalPrice < bufferedMin) {
          if (options.clampToPercentPrice) {
             const prevPrice = finalPrice;
             finalPrice = Math.min(Math.max(finalPrice, bufferedMin), bufferedMax);
             if (tickSize > 0) {
               finalPrice = roundEight(Math.round(finalPrice / tickSize) * tickSize);
             }
             this.logger.log(`${symbol}: Price ${prevPrice} clamped to buffered PERCENT_PRICE band edge ${finalPrice} (Mark: ${markPrice})`);
          } else {
            const isStopLossOrTp = !!options.skipNotionalCheck;

            if (!isStopLossOrTp) {
              this.logger.warn(`${symbol}: Price ${finalPrice} outside buffered PERCENT_PRICE band [${bufferedMin.toFixed(5)}, ${bufferedMax.toFixed(5)}] (Mark: ${markPrice})`);

              if (finalPrice > maxPrice || finalPrice < minPrice || Math.abs(finalPrice - markPrice) / markPrice > 0.05) {
                 this.logger.error(`${symbol}: CRITICAL - Price too far from Mark or outside bands. Rejecting order.`);
                 return { price: finalPrice, qty: 0 };
              }
            } else {
              const deviation = Math.abs(finalPrice - markPrice) / markPrice;
              if (deviation > 0.1) {
                this.logger.warn(`${symbol}: SL/TP Price ${finalPrice} significantly far from Mark (${(deviation * 100).toFixed(2)}%). Proceeding with filtered price.`);
              }
            }
          }
        }
      }
    }

    if (filters.stepSize > 0) {
      finalQty = floorStep(qty, filters.stepSize);

      if (filters.marketMaxQty !== undefined) {
        if (finalQty > filters.marketMaxQty) {
          this.logger.warn(`${symbol}: Quantity ${finalQty} exceeds MARKET_LOT_SIZE maxQty ${filters.marketMaxQty}. Clamping.`);
          finalQty = filters.marketMaxQty;
        }
        if (finalQty < filters.marketMinQty && finalQty > 0) {
          this.logger.warn(`${symbol}: Quantity ${finalQty} below MARKET_LOT_SIZE minQty ${filters.marketMinQty}.`);
          finalQty = 0;
        }
      }
    }

    if (!options.skipNotionalCheck && filters.minNotional !== undefined) {
      if (finalQty * finalPrice < filters.minNotional) {
        this.logger.warn(`${symbol}: Order notional ${finalQty * finalPrice} is below minimum ${filters.minNotional}`);
        return { price: finalPrice, qty: 0 };
      }
    }

    return { price: finalPrice, qty: finalQty };
  }

  async checkLeverageBracket(
    symbol: string,
    notional: number,
    paperMode: boolean,
    binanceClient: any,
    updateWeight: (headers: any) => void,
    fetchPosition: (symbol: string, options?: { forceFresh?: boolean }) => Promise<BinancePositionV3 | null>
  ): Promise<{ isAllowed: boolean; maxNotional?: number }> {
    if (paperMode || !binanceClient) return { isAllowed: true };

    try {
      const now = Date.now();
      if (this.leverageBrackets.size === 0 || (now - this.lastBracketFetch > 3600000)) {
         this.logger.debug(`[OrderFilter] Fetching fresh leverage brackets...`);
         const response = await (binanceClient.restAPI as any).notionalAndLeverageBrackets();
         updateWeight(response.headers);
         const data = (await response.data()) as any[];
         if (Array.isArray(data)) {
            this.leverageBrackets.clear();
            for (const b of data) {
               this.leverageBrackets.set(b.symbol, b.brackets);
            }
            this.lastBracketFetch = now;
         }
      }

      const brackets = this.leverageBrackets.get(symbol);
      if (!brackets || !Array.isArray(brackets)) return { isAllowed: true };

      let pos = await fetchPosition(symbol, { forceFresh: false });
      let currentLeverage = (pos && parseInt(pos.leverage || '0') > 0) ? parseInt(pos.leverage) : 0;

      if (currentLeverage <= 0) {
         const freshPos = await fetchPosition(symbol, { forceFresh: true });
         currentLeverage = (freshPos && parseInt(freshPos.leverage || '0') > 0) ? parseInt(freshPos.leverage) : 20;
         pos = freshPos;
      }

      const currentNotional = pos ? Math.abs(parseFloat(pos.notional || '0')) : 0;
      const totalNotional = currentNotional + notional;

      const activeBracket = [...brackets].reverse().find(b => currentLeverage <= b.initialLeverage) || brackets[0];

      if (activeBracket && totalNotional > activeBracket.notionalCap) {
         this.logger.warn(`[OrderFilter] Leverage Cap Breach for ${symbol}: Total Notional ${totalNotional.toFixed(2)} exceeds cap ${activeBracket.notionalCap} at ${currentLeverage}x leverage.`);
         return { isAllowed: false, maxNotional: activeBracket.notionalCap };
      }

      return { isAllowed: true };
    } catch (err) {
      this.logger.debug(`[OrderFilter] Leverage bracket check failed for ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
      return { isAllowed: true };
    }
  }
}
