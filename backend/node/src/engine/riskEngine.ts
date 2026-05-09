import { Injectable, Logger } from '@nestjs/common';
import { SessionConfig } from '../../models/session_config';
import { Trade } from '../../models/trade';
import { v4 as uuid } from 'uuid';

@Injectable()
export class RiskEngineService {
  private readonly logger = new Logger(RiskEngineService.name);
  
  /**
   * Check if a new trade can be entered based on risk limits
   */
  async canEnter(
    activeTrades: Trade[],
    balance: number,
    symbol: string,
    config: SessionConfig,
    totalSlUsed: number
  ): Promise<{ canEnter: boolean; reason: string }> {
    // Check global max open trades
    if (activeTrades.length >= config.max_open_trades) {
      return {
        canEnter: false,
        reason: `Global max open trades (${config.max_open_trades}) reached`
      };
    }

    // Check per-symbol max open trades
    const symbolTradeCount = activeTrades.filter(t => t.symbol === symbol).length;
    if (symbolTradeCount >= config.max_open_trades_per_symbol) {
      return {
        canEnter: false,
        reason: `Max open trades for ${symbol} (${config.max_open_trades_per_symbol}) reached`
      };
    }

    // Check total risk percentage
    const totalRiskPct = (totalSlUsed / balance) * 100;
    if (totalRiskPct >= config.max_total_risk_pct) {
      return {
        canEnter: false,
        reason: `Total risk ${totalRiskPct.toFixed(2)}% >= max ${config.max_total_risk_pct}%`
      };
    }

    // Check absolute SL guard in USDT
    if (totalSlUsed >= config.total_sl_guard_usdt) {
      return {
        canEnter: false,
        reason: `Total SL ${totalSlUsed.toFixed(2)} USDT >= guard ${config.total_sl_guard_usdt} USDT`
      };
    }

    return { canEnter: true, reason: 'OK' };
  }

  /**
   * Calculate stop loss price based on SL type configuration
   */
  async computeSl(
    entryPrice: number,
    direction: 'LONG' | 'SHORT',
    config: SessionConfig,
    lookbackLows?: number[],
    lookbackHighs?: number[]
  ): Promise<number> {
    if (config.sl_type === 'pct') {
      // Simple percentage-based SL
      const distance = entryPrice * (config.sl_distance_pct / 100);
      return direction === 'LONG' ? entryPrice - distance : entryPrice + distance;
    }

    // SL based on lookback period extremes
    if (config.sl_type === 'lookback_low/high') {
      if (!lookbackLows || !lookbackHighs) {
        // Fallback to percentage if lookback data not available
        return this.computeSl(entryPrice, direction, { ...config, sl_type: 'pct' });
      }

      if (direction === 'LONG') {
        // For LONG: SL = min(lookback lows) - pct_limit
        const minLow = Math.min(...lookbackLows);
        const distance = Math.abs(minLow - entryPrice);
        const limitAdjustment = distance * (config.sl_pct_limit / 100);
        return minLow - limitAdjustment;
      } else {
        // For SHORT: SL = max(lookback highs) + pct_limit
        const maxHigh = Math.max(...lookbackHighs);
        const distance = Math.abs(maxHigh - entryPrice);
        const limitAdjustment = distance * (config.sl_pct_limit / 100);
        return maxHigh + limitAdjustment;
      }
    }

    throw new Error(`Unknown sl_type: ${config.sl_type}`);
  }

  /**
   * Calculate position size (quantity) based on risk parameters
   */
  async computePositionSize(
    balance: number,
    entryPrice: number,
    slPrice: number,
    direction: 'LONG' | 'SHORT',
    config: SessionConfig
  ): Promise<number> {
    if (balance <= 0 || entryPrice <= 0) return 0;

    const riskAmount = balance * (config.risk_pct_per_trade / 100);
    const slDistance = Math.abs(entryPrice - slPrice);
    
    if (slDistance <= 0) return 0;

    // qty = risk_amount / (sl_distance)
    // For futures, adjust based on entry_price as well
    const qty = riskAmount / slDistance;
    return qty;
  }

  /**
   * Calculate initial Take Profit price based on exit RR sequence
   */
  async computeTp(
    entryPrice: number,
    slPrice: number,
    direction: 'LONG' | 'SHORT',
    config: SessionConfig,
  ): Promise<number> {
    const risk = Math.abs(entryPrice - slPrice);
    if (risk <= 0) return entryPrice;

    // Use first exit RR threshold for initial TP
    const initialRr = config.exit_rr_sequence?.[0] || 1;
    const reward = risk * initialRr;

    return direction === 'LONG'
      ? entryPrice + reward
      : entryPrice - reward;
  }

  /**
   * Calculate Risk:Reward ratio
   */
  calculateRiskRewardRatio(
    entryPrice: number,
    slPrice: number,
    tpPrice: number,
    direction: 'LONG' | 'SHORT'
  ): number {
    const risk = Math.abs(entryPrice - slPrice);
    const reward = Math.abs(tpPrice - entryPrice);
    
    if (risk <= 0) return 0;
    
    return reward / risk;
  }
}