import {
  DerivativesTradingUsdsFutures,
  DERIVATIVES_TRADING_USDS_FUTURES_REST_API_TESTNET_URL,
  DERIVATIVES_TRADING_USDS_FUTURES_REST_API_PROD_URL
} from '@binance/derivatives-trading-usds-futures';
import { Logger } from '@nestjs/common';

export class BinanceClientFactory {
  private static readonly logger = new Logger(BinanceClientFactory.name);

  static createClient(apiKey: string, apiSecret: string, isTestnet: boolean): DerivativesTradingUsdsFutures {
    const baseURL = isTestnet
      ? DERIVATIVES_TRADING_USDS_FUTURES_REST_API_TESTNET_URL
      : DERIVATIVES_TRADING_USDS_FUTURES_REST_API_PROD_URL;

    this.logger.log(`Initializing Binance USDS-M Futures Client | mode=${isTestnet ? 'TESTNET' : 'PROD'} | base=${baseURL}`);

    return new DerivativesTradingUsdsFutures({
      configurationRestAPI: {
        apiKey,
        apiSecret,
        basePath: baseURL
      }
    });
  }
}
