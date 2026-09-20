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
   * Calculates Average True Range (ATR) over N candles.
   */
  public calculateATR(candles: Candle[], period: number = 10): number {
    if (candles.length < 2) return 0;
    let trSum = 0;
    const startIdx = Math.max(1, candles.length - period);
    const count = candles.length - startIdx;
    if (count <= 0) return 0;

    for (let i = startIdx; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trSum += tr;
    }

    return trSum / count;
  }

  /**
   * Calculates EMA series for a given array of close prices.
   */
  public calculateEMAValues(prices: number[], period: number): number[] {
    if (prices.length < period) return [];
    const k = 2 / (period + 1);
    const emaValues: number[] = new Array(prices.length);

    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += prices[i];
    }
    emaValues[period - 1] = sum / period;

    for (let i = period; i < prices.length; i++) {
      emaValues[i] = prices[i] * k + emaValues[i - 1] * (1 - k);
    }

    return emaValues;
  }

  /**
   * Calculates MACD histogram series from candle closes.
   */
  public calculateMACDHistogramSeries(
    candles: Candle[],
    fastPeriod = 12,
    slowPeriod = 26,
    signalPeriod = 9
  ): number[] {
    if (candles.length < slowPeriod + signalPeriod) return [];
    const closes = candles.map(c => c.close);

    const fastEma = this.calculateEMAValues(closes, fastPeriod);
    const slowEma = this.calculateEMAValues(closes, slowPeriod);

    const macdLine: number[] = [];
    const macdStartIdx = slowPeriod - 1;

    for (let i = macdStartIdx; i < closes.length; i++) {
      macdLine.push(fastEma[i] - slowEma[i]);
    }

    if (macdLine.length < signalPeriod) return [];

    const signalEma = this.calculateEMAValues(macdLine, signalPeriod);
    const histogram: number[] = [];
    const signalStartIdx = signalPeriod - 1;

    for (let i = signalStartIdx; i < macdLine.length; i++) {
      histogram.push(macdLine[i] - signalEma[i]);
    }

    return histogram;
  }

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

    // Calculate True ATR over 10 candles for distance scaling
    const atr = this.calculateATR(candles, 10) || (currentPrice * 0.01);

    // Lookback for price velocity over 3 candles
    const prevPriceIdx = Math.max(0, candles.length - 4);
    const lookbackCount = (candles.length - 1) - prevPriceIdx;
    const priceDelta = currentCandle.close - candles[prevPriceIdx].close;
    const priceVelocity = lookbackCount > 0 ? priceDelta / lookbackCount : 0;

    // --- ESTIMATOR 2: SUPERTREND TREND & CROSSOVER ---
    if (baseType === 'supertrend') {
      const thresh = Number(signalDetail?.threshold || 0);
      if (thresh > 0) {
        const dist = Math.abs(currentPrice - thresh);
        const { estPnl, estR } = computePnLAndR(thresh);

        // Directional velocity towards Supertrend threshold
        const dirVelocity = isLong ? -priceVelocity : priceVelocity;
        const effectiveSpeed = Math.max(dirVelocity, atr / 5);

        const etaCandles = Math.max(1, Math.round((dist / effectiveSpeed) * 10) / 10);
        const etaSeconds = Math.round((etaCandles * intervalMs) / 1000);
        const proximity = Math.min(99, Math.max(1, Math.round(Math.max(0, 1 - (dist / (3 * atr))) * 100)));

        return {
          signalType,
          state: 'approaching',
          proximity,
          etaCandles,
          etaSeconds,
          confidence: 82,
          estimatedExitPrice: thresh,
          estimatedPnl: estPnl,
          estimatedR: estR,
          method: 'indicator_convergence',
          description: `Supertrend band ${dist.toFixed(2)} away (ATR: ${atr.toFixed(2)})`,
          components: { atr: roundTo(atr, 4), distance: roundTo(dist, 4) }
        };
      }
    }

    // --- ESTIMATOR 3: MACD IMPULSE / FADE / PBC ---
    if (baseType === 'macd_impulse' || baseType === 'macd_fade' || baseType === 'macd_pbc') {
      const sp = config.signal_params || {};
      const fastPeriod = Number(sp.macd_fast || 12);
      const slowPeriod = Number(sp.macd_slow || 26);
      const signalPeriod = Number(sp.macd_signal || 9);

      const histSeries = this.calculateMACDHistogramSeries(candles, fastPeriod, slowPeriod, signalPeriod);

      if (histSeries.length >= 3) {
        const currHist = histSeries[histSeries.length - 1];
        const prevHist = histSeries[histSeries.length - 2];
        const histVelocity = currHist - prevHist; // Velocity of histogram change per candle

        // Long exit triggers when green histogram contracts (velocity < 0) or flips negative (currHist < 0)
        // Short exit triggers when red histogram contracts (velocity > 0) or flips positive (currHist > 0)
        const isFading = isLong ? (currHist < 0 || histVelocity < 0) : (currHist > 0 || histVelocity > 0);

        if (isFading) {
          // If already crossed 0 or flipped, it's ready/firing
          const isCrossed = isLong ? currHist <= 0 : currHist >= 0;
          if (isCrossed) {
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
              method: 'momentum_projection',
              description: 'MACD histogram reversal condition met',
              components: { currHist: roundTo(currHist, 6), histVelocity: roundTo(histVelocity, 6) }
            };
          }

          // Distance remaining to 0-level histogram reversal
          const distToZero = Math.abs(currHist);
          const contractionSpeed = Math.max(Math.abs(histVelocity), 1e-6);
          const etaCandles = Math.max(1, Math.round((distToZero / contractionSpeed) * 10) / 10);
          const etaSeconds = Math.round((etaCandles * intervalMs) / 1000);

          const estimatedExitPrice = roundTo(currentPrice + priceVelocity * etaCandles, 8);
          const { estPnl, estR } = computePnLAndR(estimatedExitPrice);
          const proximity = Math.min(99, Math.max(1, Math.round((1 - (distToZero / (distToZero + contractionSpeed * 5))) * 100)));

          return {
            signalType,
            state: 'approaching',
            proximity,
            etaCandles,
            etaSeconds,
            confidence: 76,
            estimatedExitPrice,
            estimatedPnl: estPnl,
            estimatedR: estR,
            method: 'momentum_projection',
            description: `MACD histogram fading towards reversal (~${etaCandles} candles)`,
            components: { currHist: roundTo(currHist, 6), histVelocity: roundTo(histVelocity, 6), priceVelocity: roundTo(priceVelocity, 8) }
          };
        } else {
          // Histogram expanding in favor of position
          return {
            signalType,
            state: 'diverging',
            proximity: 15,
            etaCandles: null,
            etaSeconds: null,
            confidence: 60,
            estimatedExitPrice: null,
            estimatedPnl: null,
            estimatedR: null,
            method: 'momentum_projection',
            description: 'MACD histogram expanding in trade direction',
            components: { currHist: roundTo(currHist, 6), histVelocity: roundTo(histVelocity, 6) }
          };
        }
      }
    }

    // --- ESTIMATOR 4: SINGLE EMA / MA / INDICATOR CONVERGENCE ---
    const thresh = Number(signalDetail?.threshold || 0);
    const val = Number(signalDetail?.value ?? currentPrice);

    if (thresh > 0) {
      const dist = Math.abs(val - thresh);
      const effectiveSpeed = Math.max(Math.abs(priceVelocity), atr / 4);

      const etaCandles = Math.max(1, Math.round((dist / effectiveSpeed) * 10) / 10);
      const etaSeconds = Math.round((etaCandles * intervalMs) / 1000);
      const targetPrice = signalDetail?.threshold_is_price ? thresh : roundTo(currentPrice + (isLong ? -dist : dist), 8);
      const { estPnl, estR } = computePnLAndR(targetPrice);
      const proximity = Math.min(99, Math.max(1, Math.round(Math.max(0, 1 - (dist / (3 * atr))) * 100)));

      return {
        signalType,
        state: 'approaching',
        proximity,
        etaCandles,
        etaSeconds,
        confidence: 80,
        estimatedExitPrice: targetPrice,
        estimatedPnl: estPnl,
        estimatedR: estR,
        method: 'indicator_convergence',
        description: `Approaching indicator threshold (${dist.toFixed(2)} away)`,
        components: { atr: roundTo(atr, 4), distance: roundTo(dist, 4) }
      };
    }

    // --- ESTIMATOR 5: MOMENTUM % / BREAKOUT H/L / ENGULFING ---
    if (baseType === 'breakout_hl') {
      const lookback = Number(config.signal_params?.scan_lookback || 3);
      if (candles.length >= lookback + 1) {
        const slice = candles.slice(-lookback - 1, -1);
        const boundPrice = isLong
          ? Math.min(...slice.map(c => c.low))
          : Math.max(...slice.map(c => c.high));

        const dist = Math.abs(currentPrice - boundPrice);
        const { estPnl, estR } = computePnLAndR(boundPrice);
        const effectiveSpeed = Math.max(Math.abs(priceVelocity), atr / 4);
        const etaCandles = Math.max(1, Math.round((dist / effectiveSpeed) * 10) / 10);
        const etaSeconds = Math.round((etaCandles * intervalMs) / 1000);
        const proximity = Math.min(99, Math.max(1, Math.round(Math.max(0, 1 - (dist / (2 * atr))) * 100)));

        return {
          signalType,
          state: 'approaching',
          proximity,
          etaCandles,
          etaSeconds,
          confidence: 75,
          estimatedExitPrice: boundPrice,
          estimatedPnl: estPnl,
          estimatedR: estR,
          method: 'event_state',
          description: `Approaching ${lookback}-period ${isLong ? 'low' : 'high'} boundary (${boundPrice.toFixed(2)})`,
          components: { boundPrice: roundTo(boundPrice, 8), distance: roundTo(dist, 4) }
        };
      }
    }

    if (baseType === 'momentum_pct') {
      const thresholdPct = Number(config.signal_params?.scan_pct_threshold || 2.0);
      const lookback = Number(config.signal_params?.scan_lookback || 3);
      if (candles.length >= lookback + 1) {
        const pastPrice = candles[candles.length - 1 - lookback].close;
        const currentPct = Math.abs((currentPrice - pastPrice) / pastPrice) * 100;
        const proximity = Math.min(99, Math.max(1, Math.round((currentPct / thresholdPct) * 100)));
        const { estPnl, estR } = computePnLAndR(currentPrice);

        return {
          signalType,
          state: 'approaching',
          proximity,
          etaCandles: 1,
          etaSeconds: Math.round(intervalMs / 1000),
          confidence: 70,
          estimatedExitPrice: currentPrice,
          estimatedPnl: estPnl,
          estimatedR: estR,
          method: 'momentum_projection',
          description: `Momentum at ${currentPct.toFixed(2)}% / ${thresholdPct}% target`,
          components: { currentPct: roundTo(currentPct, 2), thresholdPct }
        };
      }
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
