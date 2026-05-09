import { Injectable, Logger } from '@nestjs/common';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { SignalEngineService } from './signalEngine';
import { v4 as uuid } from 'uuid';

@Injectable()
export class OrderManagerService {
  private readonly logger = new Logger(OrderManagerService.name);

  private binanceClient: any = null;
  private paperMode = true;

  constructor(private readonly signalEngine: SignalEngineService) {}

  setBinanceClient(client: any, paperMode = true) {
    this.binanceClient = client;
    this.paperMode = paperMode;
  }

  async enter(
    strategyId: string,
    symbol: string,
    direction: 'LONG' | 'SHORT',
    entryPrice: number,
    qty: number,
    slPrice: number,
    tpPrice: number,
  ): Promise<Trade | null> {
    try {
      const trade = {
        id: uuid(),
        symbol,
        direction,
        entry_price: entryPrice,
        qty,
        initial_sl: slPrice,
        current_sl: slPrice,
        tp: tpPrice,
        entry_ts: new Date(),
        max_rr_achieved: 0.0,
        rr_sequence_index: -1,
        sl_adjustments: [],
        status: 'OPEN',
        entry_signal_type: 'combo',
        entry_signal_confidence: 1.0,
        pnl: 0,
        pnl_pct: 0,
      } as Trade;

      // In live mode, attempt to place actual order
      if (!this.paperMode && this.binanceClient) {
        try {
          const binanceDirection = direction === 'LONG' ? 'BUY' : 'SELL';
          const response = await this.binanceClient.futures_create_order({
            symbol,
            side: binanceDirection,
            type: 'MARKET',
            quantity: qty,
          });
          trade.binance_order_id = response.orderId;
          this.logger.log(
            `Binance order placed: ${symbol} ${direction} qty=${qty} order_id=${response.orderId}`,
          );
        } catch (err) {
          this.logger.warn(
            `Binance order failed (continuing in paper mode): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      this.logger.log(
        `Enter: ${symbol} ${direction} @ ${entryPrice} qty=${qty} SL=${slPrice} TP=${tpPrice}`,
      );
      return trade;
    } catch (error) {
      this.logger.error(`Enter failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async checkExitSignals(
    symbol: string,
    trade: Trade,
    config: SessionConfig,
    interval: string = '1m',
  ): Promise<{ exitTriggered: boolean; exitSignalType?: string }> {
    if (!config.exit_signals || config.exit_signals.length === 0) {
      return { exitTriggered: false };
    }

    // Check each exit signal
    // Exit signals work like entry signals but in opposite direction
    for (const exitSignal of config.exit_signals) {
      try {
        // Create temp config with only the exit signal enabled
        const tempConfig = {
          ...config,
          enabled_signals: [exitSignal],
        };

        const result = await this.signalEngine.checkEntry(symbol, tempConfig, interval);

        if (result.allFired) {
          this.logger.log(`Exit signal ${exitSignal} fired for ${symbol}`);
          return { exitTriggered: true, exitSignalType: exitSignal };
        }
      } catch (err) {
        this.logger.debug(
          `Exit signal ${exitSignal} check error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { exitTriggered: false };
  }

  async closeTrade(
    symbol: string,
    trade: Trade,
    exitPrice: number,
    exitReason: string,
    paperMode = true,
  ): Promise<{ trade: Trade; exitOccurred: boolean }> {
    try {
      // Calculate P&L
      const pnlPoints = trade.direction === 'LONG'
        ? exitPrice - trade.entry_price
        : trade.entry_price - exitPrice;

      const pnl = pnlPoints * trade.quantity || 0;
      const pnlPct = (pnlPoints / trade.entry_price) * 100;

      // Update trade
      trade.exit_price = exitPrice;
      trade.exit_ts = new Date();
      trade.pnl = pnl;
      trade.pnl_pct = pnlPct;
      trade.exit_reason = exitReason;

      // Determine status
      if (exitReason.includes('SL')) {
        trade.status = 'CLOSED_SL';
      } else if (exitReason.includes('TP')) {
        trade.status = 'CLOSED_TP';
      } else if (exitReason.includes('SIGNAL')) {
        trade.status = 'CLOSED_SIGNAL';
      } else {
        trade.status = 'CLOSED_SIGNAL';
      }

      // In live mode, place close order
      if (!paperMode && this.binanceClient) {
        try {
          const closeDirection = trade.direction === 'LONG' ? 'SELL' : 'BUY';
          const response = await this.binanceClient.futures_create_order({
            symbol,
            side: closeDirection,
            type: 'MARKET',
            quantity: trade.quantity || 0,
          });
          trade.binance_close_order_id = response.orderId;
          this.logger.log(
            `Binance close order placed: ${symbol} qty=${trade.quantity || 0} order_id=${response.orderId}`,
          );
        } catch (err) {
          this.logger.warn(
            `Binance close order failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      this.logger.log(
        `Close: ${symbol} @ ${exitPrice} P&L=${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%) Reason=${exitReason}`,
      );

      return { trade, exitOccurred: true };
    } catch (error) {
      this.logger.error(`Close failed: ${error instanceof Error ? error.message : String(error)}`);
      return { trade, exitOccurred: false };
    }
  }
}