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
    sessionId: string,
    symbol: string,
    direction: 'LONG' | 'SHORT',
    entryPrice: number,
    qty: number,
    slPrice: number,
    tpPrice: number | null,
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
        sessionId,
      } as Trade;

      // In live mode, attempt to place actual order
      if (!this.paperMode && this.binanceClient) {
        try {
          const binanceDirection = direction === 'LONG' ? 'BUY' : 'SELL';
          const response = await this.binanceClient.restAPI.tradeApi.newOrder(symbol, binanceDirection, 'MARKET', {
            quantity: qty,
          });
          const orderData = response.data || response;
          trade.binance_order_id = orderData.orderId;
          this.logger.log(
            `Binance order placed: ${symbol} ${direction} qty=${qty} order_id=${orderData.orderId}`,
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

    const tradeAgeSec = trade.entry_ts
      ? (Date.now() - new Date(trade.entry_ts).getTime()) / 1000
      : 0;

    const statuses: Record<string, { fired: boolean, active: boolean, remaining_delay: number, label: string }> = {};
    const delays = config.exit_signal_delays || {};
    const logic = config.exit_signal_logic || 'any';

    let firedCount = 0;
    let activeCount = 0;

    // Check each exit signal
    for (const exitSignal of config.exit_signals) {
      try {
        const delay = delays[exitSignal] || 0;
        const isActive = tradeAgeSec >= delay;
        const remaining = Math.max(0, delay - tradeAgeSec);

        // Create temp config with only the exit signal enabled
        const tempConfig = {
          ...config,
          enabled_signals: [exitSignal],
        };

        const result = await this.signalEngine.checkEntry(
          symbol,
          tempConfig,
          interval,
          trade.direction,
          'exit'
        );
        const isFired = result.allFired;

        statuses[exitSignal] = {
          fired: isFired,
          active: isActive,
          remaining_delay: remaining,
          label: exitSignal, // Could map to pretty name if needed
        };

        if (isFired && isActive) {
          firedCount++;
        }
        if (isActive) {
          activeCount++;
        }
      } catch (err) {
        this.logger.debug(
          `Exit signal ${exitSignal} check error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Update trade status for frontend
    trade.exit_signals_status = statuses;

    const allEnabled = config.exit_signals.length;
    let exitTriggered = false;
    let exitSignalType: string | undefined;

    if (logic === 'any') {
      exitTriggered = firedCount > 0;
      if (exitTriggered) {
        exitSignalType = Object.keys(statuses).find(k => statuses[k].fired && statuses[k].active);
      }
    } else {
      // 'all' logic: all signals must be active AND fired
      exitTriggered = firedCount === allEnabled && activeCount === allEnabled;
      if (exitTriggered) {
        exitSignalType = 'combined';
      }
    }

    if (exitTriggered) {
      this.logger.log(`Exit triggered for ${symbol} via ${logic.toUpperCase()} logic (signals fired: ${firedCount}/${allEnabled})`);
    }

    return { exitTriggered, exitSignalType };
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

      const pnl = pnlPoints * trade.qty || 0;
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
          const response = await this.binanceClient.restAPI.tradeApi.newOrder(symbol, closeDirection, 'MARKET', {
            quantity: trade.qty || 0,
          });
          const orderData = response.data || response;
          trade.binance_close_order_id = orderData.orderId;
          this.logger.log(
            `Binance close order placed: ${symbol} qty=${trade.qty || 0} order_id=${orderData.orderId}`,
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
