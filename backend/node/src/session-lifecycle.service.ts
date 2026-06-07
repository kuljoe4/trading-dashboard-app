import { Injectable, Logger } from '@nestjs/common';
import { BinanceClientFactory } from '../binance-client.factory';

@Injectable()
export class SessionLifecycleService {
  private readonly logger = new Logger(SessionLifecycleService.name);
  private binanceClient: any;

  constructor() {
    this.binanceClient = BinanceClientFactory.createTestnetClient();
  }

  async initializeSession() {
    try {
      const balance = await this.binanceClient.getBalance();

      if (balance && typeof balance === 'string') {
        const usdtBalance = balance.substring(0, balance.indexOf(' '));
        this.logger.info(`Initial Binance testnet balance: ${usdtBalance} USDT`);
      } else {
        this.logger.error('Balance response is invalid or missing');
        throw new Error('Balance data not available');
      }
    } catch (error) {
      this.logger.error('Balance fetch failed:', error.message);
      throw error;
    }
  }
}