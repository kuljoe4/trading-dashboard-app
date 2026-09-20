import { Injectable, Logger } from '@nestjs/common';
import { Candle, KlineStoreService } from './kline_store.service';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { ExitEstimation, CompositeExitEstimation, ExitState, ExitMethod } from '../models/ExitEstimation';
import { roundTo, parseIntervalToMs } from '../lib/math';

@Injectable()
export class ExitEstimationService {
  private readonly logger = new Logger(ExitEstimationService.name);

  constructor(private readonly klineStore: KlineStoreService) {}

  /**
   * Single-signal exit estimation logic based on exact technical indicator dynamics.
   */
  public estimateExitSignal(
    signalType: string,
    trade: Trade,
    config: SessionConfig,
    interval: string = '1m',
    passedCandles?: Candle[],
    signalDetail?: any
  ): ExitEstimation {
    const symbol = trade.symbol;
    const isLong = trade.direction === 'LONG';
    const entryPrice = trade.entry_price;
    const qty = trade.qty;
    const initialRiskUsdt = trade.initial_risk_usdt || (Math.abs(entryPrice - trade.initial_sl) * qty);

    const signalTf = config.signal_timeframes?.[signalType] && config.signal_timeframes[signalType] !== 'default'
      ? config.signal_timeframes[signalType]
      : interval;

    const candles = passedCandles || this.klineStore.getRawCandles(symbol, signalTf);
    const intervalMs = parseIntervalToMs(signalTf);

    if (candles.length < 5) {
      return {
        signalType,
        state: 'approaching',
        proximity: 0,
        etaCandles: null,
        etaSeconds: null,
        confidence: 0,
        estimatedExitPrice: null,
        estimatedPnl: null,
        estimatedR: null,
        method: 'event_state',
        description: 'Insufficient candle data for exit estimation'
      };
    }

    const currentCandle = candles[candles.length - 1];
    const currentPrice = currentCandle.close;

    // Helper for PnL / R calculations
    const computePnLAndR = (estPrice: number) => {
      if (!estPrice || estPrice <= 0 || qty <= 0) return { estPnl: null, estR: null };
      const rawPnl = isLong
        ? (estPrice - entryPrice) * qty
        : (entryPrice - estPrice) * qty;
      const estPnl = roundTo(rawPnl, 2);
      const estR = initialRiskUsdt > 0 ? roundTo(rawPnl / initialRiskUsdt, 2) : null;
      return { estPnl, estR };
    };

    // 1. Check for engine rejection or fired state
    const isFired = !!signalDetail?.fired;
    const isBlocked = !!(signalDetail?.rejected || signalDetail?.status === 'blocked');
    const isStale = !!(signalDetail?.status === 'stale');

    if (isFired) {
      const { estPnl, estR } = computePnLAndR(currentPrice);
      return {
        signalType,
        state: 'fired',
        proximity: 100,
        etaCandles: 0,
        etaSeconds: 0,
        confidence: 100,
        estimatedExitPrice: currentPrice,
        estimatedPnl: estPnl,
        estimatedR: estR,
        method: 'event_state',
        description: 'Exit signal fired'
      };
    }

    if (isBlocked) {
      return {
        signalType,
        state: 'blocked',
        proximity: 0,
        etaCandles: null,
        etaSeconds: null,
        confidence: 0,
        estimatedExitPrice: null,
        estimatedPnl: null,
        estimatedR: null,
        method: 'event_state',
        description: signalDetail?.description || 'Blocked by filter'
      };
    }

    if (isStale) {
      return {
        signalType,
        state: 'stale',
        proximity: 0,
        etaCandles: null,
        etaSeconds: null,
        confidence: 0,
        estimatedExitPrice: null,
        estimatedPnl: null,
        estimatedR: null,
        method: 'event_state',
        description: 'Exit condition already passed'
      };
    }

    let baseType = signalType;
    const lastUnderscore = signalType.lastIndexOf('_');
    if (lastUnderscore > 0) {
      const potentialBase = signalType.substring(0, lastUnderscore);
      if (['ema', 'ema_cross', 'ema_dual_cross', 'ema_close', 'ema_dual_close', 'macd_impulse', 'macd_fade', 'macd_pbc', 'supertrend'].includes(potentialBase)) {
        baseType = potentialBase;
      }
    }

    // --- ESTIMATOR 1: DUAL EMA CONVERGENCE (ema_dual_cross) ---
    if (baseType === 'ema_dual_cross' || baseType === 'ema_dual_close') {
      const val = Number(signalDetail?.value || 0);
      const thresh = Number(signalDetail?.threshold || 0);

      // Look back 3-5 candles to estimate Fast EMA velocity ($V_f$) and Slow EMA velocity ($V_s$)
      const prevIdx = Math.max(0, candles.length - 4);
      const lookbackCount = (candles.length - 1) - prevIdx;

      // Price velocity
      const priceDelta = currentCandle.close - candles[prevIdx].close;
      const priceVelocity = lookbackCount > 0 ? priceDelta / lookbackCount : 0;

      if (val > 0 && thresh > 0) {
        // Fast/Slow spread: distance remaining until cross
        // For LONG: before cross, Fast < Slow, so distance = Slow - Fast (thresh - val)
        // For SHORT: before cross, Fast > Slow, so distance = Fast - Slow (val - thresh)
        const currentSpread = isLong ? (thresh - val) : (val - thresh);

        // Previous spread
        const prevFast = Number(signalDetail?.prevFast || val);
        const prevSlow = Number(signalDetail?.prevSlow || thresh);
        const prevSpread = isLong ? (prevSlow - prevFast) : (prevFast - prevSlow);

        // Spread contraction rate per candle: negative rate means spread is narrowing towards 0 (crossover)
        const spreadDelta = currentSpread - prevSpread;
        const spreadVelocity = lookbackCount > 0 ? -(spreadDelta / lookbackCount) : 0;

        if (spreadVelocity > 0 && currentSpread > 0) {
          const rawEta = currentSpread / spreadVelocity;
          const etaCandles = Math.max(1, Math.round(rawEta * 10) / 10);
          const etaSeconds = Math.round((etaCandles * intervalMs) / 1000);

          const estimatedExitPrice = roundTo(currentPrice + priceVelocity * etaCandles, 8);
          const { estPnl, estR } = computePnLAndR(estimatedExitPrice);
          const proximity = Math.min(99, Math.max(1, Math.round((1 - (currentSpread / (currentSpread + spreadVelocity * 5))) * 100)));

          return {
            signalType,
            state: 'approaching',
            proximity,
            etaCandles,
            etaSeconds,
            confidence: 78,
            estimatedExitPrice,
            estimatedPnl: estPnl,
            estimatedR: estR,
            method: 'dual_convergence',
            description: `Fast/Slow EMA converging (~${etaCandles} candles)`,
            components: {
              fastValue: val,
              slowValue: thresh,
              spread: roundTo(currentSpread, 8),
              spreadVelocity: roundTo(spreadVelocity, 8),
              priceVelocity: roundTo(priceVelocity, 8)
            }
          };
        } else if (currentSpread <= 0) {
          // Cross already satisfied
          const { estPnl, estR } = computePnLAndR(currentPrice);
          return {
            signalType,
            state: 'ready',
            proximity: 99,
            etaCandles: 0,
            etaSeconds: 0,
            confidence: 90,
            estimatedExitPrice: currentPrice,
            estimatedPnl: estPnl,
            estimatedR: estR,
            method: 'dual_convergence',
            description: 'EMA cross condition met',
            components: { fastValue: val, slowValue: thresh, spread: roundTo(currentSpread, 8) }
          };
        } else {
          // Spread is widening (diverging)
          return {
            signalType,
            state: 'diverging',
            proximity: 0,
            etaCandles: null,
            etaSeconds: null,
            confidence: 60,
            estimatedExitPrice: null,
            estimatedPnl: null,
            estimatedR: null,
            method: 'dual_convergence',
            description: 'Fast/Slow EMA diverging',
            components: { fastValue: val, slowValue: thresh, spread: roundTo(currentSpread, 8), spreadVelocity: roundTo(spreadVelocity, 8) }
          };
        }
      }
    }

    // --- ESTIMATOR 2: SINGLE EMA / MA / INDICATOR CONVERGENCE ---
    const thresh = Number(signalDetail?.threshold || 0);
    const val = Number(signalDetail?.value ?? currentPrice);

    if (thresh > 0) {
      const dist = Math.abs(val - thresh);
      const prevPrice = candles[Math.max(0, candles.length - 4)].close;
      const speed = Math.max(0.01, Math.abs(currentPrice - prevPrice) / 3);

      const etaCandles = Math.max(1, Math.round((dist / speed) * 10) / 10);
      const etaSeconds = Math.round((etaCandles * intervalMs) / 1000);
      const targetPrice = signalDetail?.threshold_is_price ? thresh : currentPrice;
      const { estPnl, estR } = computePnLAndR(targetPrice);
      const refScale = signalDetail?.threshold_is_price ? currentPrice * 0.05 : thresh;
      const proximity = Math.min(99, Math.max(1, Math.round(Math.max(0, 1 - (dist / Math.max(refScale, 1e-8))) * 100)));

      return {
        signalType,
        state: 'approaching',
        proximity,
        etaCandles,
        etaSeconds,
        confidence: 85,
        estimatedExitPrice: targetPrice,
        estimatedPnl: estPnl,
        estimatedR: estR,
        method: 'indicator_convergence',
        description: `Approaching target (${dist.toFixed(2)} away)`
      };
    }

    // --- ESTIMATOR 3: SUPERTREND TREND & CROSSOVER ---
    if (baseType === 'supertrend') {
      const thresh = Number(signalDetail?.threshold || 0);
      if (thresh > 0) {
        const dist = Math.abs(currentPrice - thresh);
        const atr = dist * 0.5; // Approximation if ATR not explicitly passed
        const { estPnl, estR } = computePnLAndR(thresh);
        const proximity = Math.min(99, Math.max(1, Math.round((1 - (dist / currentPrice)) * 100)));

        return {
          signalType,
          state: 'approaching',
          proximity,
          etaCandles: Math.max(1, Math.round(dist / Math.max(atr, 1e-8))),
          etaSeconds: Math.round((dist / Math.max(atr, 1e-8)) * (intervalMs / 1000)),
          confidence: 80,
          estimatedExitPrice: thresh,
          estimatedPnl: estPnl,
          estimatedR: estR,
          method: 'indicator_convergence',
          description: `Supertrend band ${dist.toFixed(2)} away`,
          components: { atr: roundTo(atr, 4) }
        };
      }
    }

    // --- ESTIMATOR 4: MACD IMPULSE / FADE / PBC ---
    if (baseType === 'macd_impulse' || baseType === 'macd_fade' || baseType === 'macd_pbc') {
      const { estPnl, estR } = computePnLAndR(currentPrice);
      return {
        signalType,
        state: 'approaching',
        proximity: 50,
        etaCandles: 2,
        etaSeconds: Math.round((2 * intervalMs) / 1000),
        confidence: 65,
        estimatedExitPrice: currentPrice,
        estimatedPnl: estPnl,
        estimatedR: estR,
        method: 'momentum_projection',
        description: 'Monitoring MACD histogram momentum sequence'
      };
    }

    // --- DEFAULT FALLBACK FOR PATTERN / EVENT SIGNALS (Engulfing, Knife Catch) ---
    const { estPnl, estR } = computePnLAndR(currentPrice);
    return {
      signalType,
      state: 'approaching',
      proximity: 0,
      etaCandles: null,
      etaSeconds: null,
      confidence: 30,
      estimatedExitPrice: currentPrice,
      estimatedPnl: estPnl,
      estimatedR: estR,
      method: 'event_state',
      description: 'Event-based signal (0% until qualifying structure develops)'
    };
  }

  /**
   * Aggregates multiple exit signal estimations based on configured logic (ANY, ALL, COMBO).
   */
  public estimateExitMonitoring(
    trade: Trade,
    config: SessionConfig,
    interval: string = '1m',
    passedCandles?: Candle[],
    signalDetails?: Record<string, any>
  ): CompositeExitEstimation {
    const exitSignals = config.exit_signals || [];
    const logic = config.exit_signal_logic || 'any';
    const requiredExitSigs = config.required_exit_signals || [];

    if (exitSignals.length === 0) {
      return {
        selectedSignalKey: null,
        state: 'approaching',
        proximity: 0,
        etaCandles: null,
        etaSeconds: null,
        confidence: 0,
        estimatedExitPrice: null,
        estimatedPnl: null,
        estimatedR: null,
        description: 'No exit signals configured',
        signalEstimations: {}
      };
    }

    const signalEstimations: Record<string, ExitEstimation> = {};

    for (const sigKey of exitSignals) {
      const detail = signalDetails?.[sigKey] || trade.exit_signals_status?.[sigKey];
      signalEstimations[sigKey] = this.estimateExitSignal(
        sigKey,
        trade,
        config,
        interval,
        passedCandles,
        detail
      );
    }

    const estimationsList = Object.values(signalEstimations);

    // Any fired signal takes top priority
    const firedEst = estimationsList.find(e => e.state === 'fired');
    if (firedEst) {
      return {
        selectedSignalKey: firedEst.signalType,
        state: 'fired',
        proximity: 100,
        etaCandles: 0,
        etaSeconds: 0,
        confidence: 100,
        estimatedExitPrice: firedEst.estimatedExitPrice,
        estimatedPnl: firedEst.estimatedPnl,
        estimatedR: firedEst.estimatedR,
        description: `Exit fired by ${firedEst.signalType}`,
        signalEstimations
      };
    }

    // Any ready signal takes next priority
    const readyEst = estimationsList.find(e => e.state === 'ready');
    if (readyEst) {
      return {
        selectedSignalKey: readyEst.signalType,
        state: 'ready',
        proximity: 99,
        etaCandles: 0,
        etaSeconds: 0,
        confidence: readyEst.confidence,
        estimatedExitPrice: readyEst.estimatedExitPrice,
        estimatedPnl: readyEst.estimatedPnl,
        estimatedR: readyEst.estimatedR,
        description: `Exit ready via ${readyEst.signalType}`,
        signalEstimations
      };
    }

    if (logic === 'any') {
      // ANY logic: Select actionable signal with shortest non-null ETA or highest proximity
      const actionable = estimationsList.filter(e => e.state === 'approaching' && e.etaCandles !== null);
      if (actionable.length > 0) {
        actionable.sort((a, b) => (a.etaCandles || 999) - (b.etaCandles || 999));
        const sel = actionable[0];
        return {
          selectedSignalKey: sel.signalType,
          state: sel.state,
          proximity: sel.proximity,
          etaCandles: sel.etaCandles,
          etaSeconds: sel.etaSeconds,
          confidence: sel.confidence,
          estimatedExitPrice: sel.estimatedExitPrice,
          estimatedPnl: sel.estimatedPnl,
          estimatedR: sel.estimatedR,
          description: sel.description,
          signalEstimations
        };
      }
    } else if (logic === 'all') {
      // ALL logic: Bottlenecked by signal with lowest proximity
      if (estimationsList.length > 0) {
        const sorted = [...estimationsList].sort((a, b) => a.proximity - b.proximity);
        const sel = sorted[0];
        return {
          selectedSignalKey: sel.signalType,
          state: sel.state,
          proximity: sel.proximity,
          etaCandles: sel.etaCandles,
          etaSeconds: sel.etaSeconds,
          confidence: sel.confidence,
          estimatedExitPrice: sel.estimatedExitPrice,
          estimatedPnl: sel.estimatedPnl,
          estimatedR: sel.estimatedR,
          description: `Bottlenecked by ${sel.signalType}`,
          signalEstimations
        };
      }
    } else if (logic === 'combo') {
      // COMBO logic: Required bottleneck combined with optional max
      const reqKeys = requiredExitSigs.length > 0 ? requiredExitSigs : [exitSignals[0]];
      const reqEsts = estimationsList.filter(e => reqKeys.includes(e.signalType));

      if (reqEsts.length > 0) {
        reqEsts.sort((a, b) => a.proximity - b.proximity);
        const sel = reqEsts[0];
        return {
          selectedSignalKey: sel.signalType,
          state: sel.state,
          proximity: sel.proximity,
          etaCandles: sel.etaCandles,
          etaSeconds: sel.etaSeconds,
          confidence: sel.confidence,
          estimatedExitPrice: sel.estimatedExitPrice,
          estimatedPnl: sel.estimatedPnl,
          estimatedR: sel.estimatedR,
          description: `Required exit ${sel.signalType}`,
          signalEstimations
        };
      }
    }

    // Fallback: Pick highest proximity estimation
    estimationsList.sort((a, b) => b.proximity - a.proximity);
    const sel = estimationsList[0];
    return {
      selectedSignalKey: sel.signalType,
      state: sel.state,
      proximity: sel.proximity,
      etaCandles: sel.etaCandles,
      etaSeconds: sel.etaSeconds,
      confidence: sel.confidence,
      estimatedExitPrice: sel.estimatedExitPrice,
      estimatedPnl: sel.estimatedPnl,
      estimatedR: sel.estimatedR,
      description: sel.description,
      signalEstimations
    };
  }
}
