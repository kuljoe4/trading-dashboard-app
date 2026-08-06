import { Injectable, Logger, Inject, forwardRef } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Settings as SettingsEntity } from "../models/entities/Settings.entity";
import { SessionConfig } from "../models/SessionConfig";
import { Trade } from "../models/Trade";
import { SessionStateService } from "./session_state.service";
import { OrderManagerService } from "./orderManager";
import { MarketFeedService } from "./market_feed.service";
import { MomentumScannerService } from "./momentum_scanner.service";
import { PositionTrackerService } from "./positionTracker";
import { MonitoringService } from "./monitoring.service";
import { ENGINE_EVENTS } from "./events";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { AuditLogService } from "../trading/audit-log.service";
import { BroadcastService } from "./broadcast.service";
import { ConfigValidationException } from "../lib/exceptions";
import { roundEight } from "../lib/math";
import { sanitize } from "../lib/logger";
import {
  BinancePositionMode,
  BinanceBalanceV3,
  BinanceListenKeyResponse,
  BinanceAccountUpdateEvent,
} from "../models/binance.types";
import { ENGINE_CONSTANTS, EXIT_REASONS } from "../models/constants";

import { LifecycleDiagnosticService } from './lifecycle-diagnostic.service';

@Injectable()
export class SessionLifecycleService {
  private readonly logger = new Logger(SessionLifecycleService.name);
  private diagnostic = new LifecycleDiagnosticService();
  private running = false;
  public isUdsConnected = false;
  private udsReconnectAttempts = 0;
  private userDataWs: any = null;
  private listenKey: string | null = null;
  private listenKeyKeepAlive: NodeJS.Timeout | null = null;
  private udsLivenessCheck: NodeJS.Timeout | null = null;
  private lastModeSync = 0;
  private isUdsStarting = false;

  // CHRONOS: Event buffering during session startup reconciliation
  private eventBuffer: any[] = [];
  private isBuffering = false;

  constructor(
    private readonly sessionState: SessionStateService,
    @Inject(forwardRef(() => OrderManagerService))
    private readonly orderManager: OrderManagerService,
    private readonly marketFeed: MarketFeedService,
    private readonly momentumScanner: MomentumScannerService,
    @Inject(forwardRef(() => PositionTrackerService))
    private readonly positionTracker: PositionTrackerService,
    private readonly monitoringService: MonitoringService,
    private readonly auditLog: AuditLogService,
    private readonly eventEmitter: EventEmitter2,
    private readonly broadcastService: BroadcastService,
    @InjectRepository(SettingsEntity)
    private readonly settingsRepository: Repository<SettingsEntity>,
  ) {}

  private async progress(msg: string, level: "info" | "warn" = "info") {
    this.logger.log(`[Lifecycle] ${msg}`);
    this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
      msg: `[Lifecycle] ${msg}`,
      level,
    });
  }

  async start(
    config: SessionConfig,
    bc?: any,
    sid?: string,
    hist: Trade[] = [],
    curBal?: number,
    open: Trade[] = [],
  ) {
    this.running = true;
    await this.progress("Starting session initialization...");

    // Load lastModeSync from DB on startup
    try {
      const settings = await this.settingsRepository.findOne({
        where: { id: "default" },
      });
      if (settings && settings.last_mode_sync) {
        this.lastModeSync = Number(settings.last_mode_sync);
      }
    } catch (e) {}

    this.sessionState.reset(config, hist, curBal, sid, open);
    const mode = config.trading_mode || (config.paper_mode ? "paper" : "live");
    await this.orderManager.setBinanceClient(bc, mode === "paper");

    if (mode !== "paper" && bc) {
      // PROACTIVE RATE LIMIT: Reset weights at session start to ensure clean slate
      this.sessionState.updateRateLimit(0);

      await this.progress(
        `Configuring Binance ${mode.toUpperCase()} account...`,
      );

      // Best Practice: Synchronize server time
      // PERF: Optimized startup - removed redundant queryUserRateLimit (Weight 20).
      // SDK handles time sync; we log the offset from actual data calls.

      try {
        // Enforce One-Way Mode (Disable Hedge Mode) - Cache for 7 days
        const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
        let shouldSyncMode = Date.now() - this.lastModeSync > CACHE_TTL;

        // RESEARCH-02: Load cached position mode from DB
        if (shouldSyncMode) {
          try {
            const settings = await this.settingsRepository.findOne({
              where: { id: "default" },
            });
            if (
              settings &&
              settings.last_mode_sync &&
              Date.now() - Number(settings.last_mode_sync) < CACHE_TTL
            ) {
              this.lastModeSync = Number(settings.last_mode_sync);
              if (settings.is_one_way_mode) {
                this.logger.debug(
                  "Loaded cached position mode from DB: One-Way.",
                );
                shouldSyncMode = false;
              }
            }
          } catch (e) {}
        }

        if (shouldSyncMode) {
          try {
            this.monitoringService.incrementApiRequests();
            const currentModeRes = await bc.restAPI.getCurrentPositionMode();
            const currentModeData =
              (await currentModeRes.data()) as BinancePositionMode;

            if (currentModeData && currentModeData.dualSidePosition === false) {
              this.logger.debug("Binance position mode is already One-Way.");

              await this.settingsRepository.update("default", {
                is_one_way_mode: true,
                last_mode_sync: Date.now(),
              });
            } else {
              this.monitoringService.incrementApiRequests();
              const modeRes = await bc.restAPI.changePositionMode({
                dualSidePosition: false,
              } as any);
              const modeData = await modeRes.data();
              const modeMsg = `Binance position mode set to One-Way: ${JSON.stringify(modeData)}`;
              this.logger.log(modeMsg);
              this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
                msg: modeMsg,
                level: "info",
              });

              await this.settingsRepository.update("default", {
                is_one_way_mode: true,
                last_mode_sync: Date.now(),
              });
            }
            this.lastModeSync = Date.now();
          } catch (modeErr: any) {
            const errMsg = modeErr.message || "";
            const errCode = modeErr.data?.code || modeErr.code;

            // Error -4059 means it's already in that mode
            if (errMsg.includes("-4059") || errCode === -4059) {
              this.logger.debug("Binance position mode is already One-Way.");
            } else if (
              errMsg.includes("-4068") ||
              errCode === -4068 ||
              errMsg.includes("open orders")
            ) {
              const criticalMsg = `CRITICAL: Cannot set One-Way Mode because there are OPEN ORDERS on your Binance account. Please close all manual orders on Binance to ensure engine consistency.`;
              this.logger.error(criticalMsg);
              this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
                msg: criticalMsg,
                level: "error",
              });
              throw new ConfigValidationException(criticalMsg);
            } else if (
              errMsg.includes("-4069") ||
              errCode === -4069 ||
              errMsg.includes("exists position")
            ) {
              const criticalMsg = `CRITICAL: Cannot set One-Way Mode because there are OPEN POSITIONS on your Binance account. Please close all manual positions on Binance to ensure engine consistency.`;
              this.logger.error(criticalMsg);
              this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
                msg: criticalMsg,
                level: "error",
              });
              throw new ConfigValidationException(criticalMsg);
            } else {
              this.logger.warn(
                `Failed to set Binance position mode to One-Way: ${errMsg}`,
              );
            }
          }
        } else {
          this.logger.debug(
            "Skipping Binance position mode sync (already cached).",
          );
        }

        await this.progress("Fetching account balance...");
        const b = await this.fetchBinanceBalance(bc);

        if (b === 0 && (curBal || 0) > 0) {
          const fallbackMsg = `Binance ${mode} returned 0 balance. Falling back to local: ${curBal} USDT.`;
          await this.progress(fallbackMsg, "warn");
          this.sessionState.balanceLive = curBal!;
          this.sessionState.balancePaper = curBal!;
          this.sessionState.lastExchangeBalance = curBal!;
        } else {
          this.sessionState.balanceLive = b;
          this.sessionState.balancePaper = b;
          this.sessionState.lastExchangeBalance = b;
          if (b === 0) {
            const zeroBalMsg = `CRITICAL: Binance ${mode.toUpperCase()} balance is 0. Initialization halted. Please fund your account.`;
            this.logger.error(zeroBalMsg);
            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
              msg: zeroBalMsg,
              level: "error",
            });
            throw new ConfigValidationException(zeroBalMsg);
          }
        }
      } catch (e) {
        if (e instanceof ConfigValidationException) throw e;
        this.logger.debug(
          `Initial account configuration failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      if (!this.isUdsConnected) {
        await this.progress("Establishing real-time account stream...");
        try {
          await this.startUserDataStream(bc);
        } catch (err) {
          const errMsg = `CRITICAL: Failed to establish real-time account stream: ${err instanceof Error ? err.message : String(err)}. Polling fallback is disabled for safety.`;
          this.logger.error(errMsg);
          this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
            msg: errMsg,
            level: "error",
          });
          throw new ConfigValidationException(errMsg);
        }
      }
    }

    await this.progress("Initializing market feed and ticker cache...");
    await this.marketFeed.start(config, bc);

    await this.progress("Warming up momentum scanner...");
    await this.momentumScanner.start(config);

    if (open.length > 0) {
      await this.progress(`Resuming ${open.length} active trades...`);
      for (const t of open) {
        this.positionTracker.addTrade(t);
        this.sessionState.updateStatsOnEntry(t.id, t.strategy_label);
      }
    }
    this.sessionState.setActiveTrades(this.positionTracker.activeList());

    await this.progress("Session ready. Trading logic engaged.");

    await this.auditLog.log({
      action: "SESSION_START",
      resourceId: sid || undefined,
      details: { mode, strategy: config.strategy_label },
    });

    return { status: "started" };
  }

  async stop(bc?: any, sid?: string, config?: SessionConfig) {
    this.running = false;
    this.isUdsConnected = false;
    await this.progress("Initiating session shutdown...");
    if (this.listenKeyKeepAlive) clearInterval(this.listenKeyKeepAlive);
    if (this.udsLivenessCheck) clearInterval(this.udsLivenessCheck);
    if (this.userDataWs) {
      await this.progress("Closing real-time account stream...");
      try {
        this.userDataWs.disconnect();
      } catch (e) {
        this.logger.debug(
          `Error disconnecting user data WS: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      this.userDataWs = null;
    }
    if (this.listenKey && bc) {
      try {
        await bc.restAPI.closeUserDataStream({ listenKey: this.listenKey });
      } catch (e) {
        this.logger.debug(
          `Error closing user data stream: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      this.listenKey = null;
    }

    await this.auditLog.log({
      action: "SESSION_STOP",
      resourceId: sid || undefined,
      details: { strategy: config?.strategy_label },
    });

    await this.progress("Cleaning up market feeds...");
    await this.marketFeed.stop();
    await this.momentumScanner.stop();
    await this.progress("Shutdown complete.");

    return { status: "stopped" };
  }

  async fetchBinanceBalance(bc: any): Promise<number> {
    if (!bc) return 0;
    // SRE: Proactive Rate Limit Guard for balance polling (non-critical)
    if (this.sessionState.isRateLimited(0.95)) {
      this.logger.warn(
        `[Lifecycle] Skipping REST balance fetch due to high API weight. Using last known: ${this.sessionState.balanceLive}`,
      );
      return this.sessionState.balanceLive;
    }

    try {
      this.monitoringService.incrementApiRequests();
      // P0 FIX: Multi-collateral support - fetch ALL balances, not just USDT
      // Live accounts commonly use Multi-Asset mode (USDC, FDUSD, etc.)
      const res = await bc.restAPI.futuresAccountBalanceV3();
      if (!res) return 0;

      // Traceability: Log successful balance fetch
      this.logger.debug(
        `[Lifecycle] Successfully fetched balance via REST V3.`,
      );

      const data = (await res.data()) as BinanceBalanceV3[];

      // Sum all positive balances across all collateral assets (USDT, USDC, FDUSD, etc.)
      if (Array.isArray(data)) {
        let totalBalance = 0;
        const allowedAssets = ['USDT', 'USDC', 'FDUSD'];
        for (const b of data) {
          if (b.asset && allowedAssets.includes(b.asset.toUpperCase())) {
            const bal = parseFloat(String(b.balance || "0"));
            if (bal > 0) {
              totalBalance += bal;
              this.sessionState.assetBalances.set(b.asset.toUpperCase(), bal);
            }
          }
        }
        if (totalBalance > 0) {
          this.logger.debug(`[Lifecycle] Multi-asset balance: ${totalBalance} (assets: ${data.filter(b => b.asset && allowedAssets.includes(b.asset.toUpperCase()) && parseFloat(b.balance||'0')>0).map(b=>b.asset).join(', ')})`);
          return totalBalance;
        }
      }

      // SENTINEL: Sanitize the raw data before logging to prevent potential credential leakage
      this.logger.warn(
        `Could not find any positive balance in Binance response. Data received: ${JSON.stringify(sanitize(data)).substring(0, 200)}`,
      );
      return 0;
    } catch (e: unknown) {
      this.logger.error(
        `Balance fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return 0;
    }
  }

  /**
   * CHRONOS: Attributes net funding fee impact to active trades.
   * Logic: If symbols are present in P[], attribute bc proportionately to notional.
   * If P[] is empty (Cross Margin), attribute to all active USDT-margined trades.
   */
  private attributeFundingFee(totalDelta: number, positions: any[]) {
    const activeTrades = this.positionTracker.activeList();
    if (activeTrades.length === 0) return;

    let targetTrades = activeTrades;

    // If symbols provided in P[], only attribute to those symbols
    if (positions && positions.length > 0) {
      const symbols = new Set(positions.map((p) => p.s));
      targetTrades = activeTrades.filter((t) => symbols.has(t.symbol));
    }

    if (targetTrades.length === 0) return;

    // Proportionate Attribution by Notional Value (Absolute)
    const notionals = targetTrades.map((t) => Math.abs(t.qty * t.entry_price));
    const totalNotional = notionals.reduce((a, b) => a + b, 0);

    if (totalNotional === 0) return;

    for (let i = 0; i < targetTrades.length; i++) {
      const trade = targetTrades[i];
      const share = notionals[i] / totalNotional;
      const delta = roundEight(totalDelta * share);

      if (delta !== 0) {
        // Binance funding 'bc' is positive for credit, negative for debit.
        // trade.funding_fee is cost (positive = paid, negative = received).
        const cost = -delta;
        trade.funding_fee = roundEight((Number(trade.funding_fee) || 0) + cost);
        trade.pnl = roundEight((Number(trade.pnl) || 0) + delta);

        this.logger.log(
          `[Chronos] Attributed funding fee to ${trade.symbol}: ${cost} USDT (Total: ${trade.funding_fee})`,
        );

        // Emit update to trigger session stats reconciliation (appliedPnL delta)
        this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, {
          trade,
          pnlDelta: delta,
        });
      }
    }
  }

  /**
   * CHRONOS: Buffer control for startup reconciliation.
   */
  public startBuffering() {
    this.logger.log("[Chronos] UDS Event Buffering engaged.");
    this.isBuffering = true;
    this.eventBuffer = [];
  }

  public stopBuffering() {
    this.isBuffering = false;
  }

  public async replayBuffer() {
    this.isBuffering = false;
    if (this.eventBuffer.length === 0) return;

    this.logger.log(
      `[Chronos] Replaying ${this.eventBuffer.length} buffered UDS events...`,
    );
    const events = [...this.eventBuffer];
    this.eventBuffer = [];

    for (const data of events) {
      try {
        if (data.e === "ACCOUNT_UPDATE") {
          this.handleAccountUpdate(data);
        } else if (data.e === "ORDER_TRADE_UPDATE") {
          this.eventEmitter.emit("binance.order_update", data);
        }
      } catch (err) {
        this.logger.error(
          `Error replaying buffered event: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.logger.log("[Chronos] UDS Buffer replay complete.");
  }

  private lastBalanceLogTs = 0;
  public handleAccountUpdate(data: BinanceAccountUpdateEvent) {
    const reason = data.a.m;

    // Real-time Balance Tracking (Zero Weight)
    // P0 FIX: Multi-collateral support - sum ALL assets in B array (USDT, USDC, FDUSD, etc.)
    if (data.a.B && data.a.B.length > 0) {
      let totalBalanceChange = 0;
      const allowedAssets = ['USDT', 'USDC', 'FDUSD'];
      let validAssetFound = false;

      for (const b of data.a.B) {
        if (b.a && allowedAssets.includes(b.a.toUpperCase())) {
          validAssetFound = true;
          const wb = parseFloat(b.wb || "0");
          const bc = parseFloat(b.bc || "0");
          if (wb >= 0) {
            if (this.sessionState.assetBalances) {
              this.sessionState.assetBalances.set(b.a.toUpperCase(), wb);
            }
          }
          totalBalanceChange += bc;
        }
      }

      if (validAssetFound) {
        let totalWalletBalance = 0;
        if (this.sessionState.assetBalances && this.sessionState.assetBalances.size > 0) {
          for (const [asset, bal] of this.sessionState.assetBalances.entries()) {
            if (allowedAssets.includes(asset)) {
              totalWalletBalance += bal;
            }
          }
        } else {
          // Fallback if assetBalances cache is uninitialized (e.g. in unit tests)
          for (const b of data.a.B) {
            if (b.a && allowedAssets.includes(b.a.toUpperCase())) {
              const wb = parseFloat(b.wb || "0");
              if (wb > 0) totalWalletBalance += wb;
            }
          }
        }

        const nb = totalWalletBalance;
        const bc = totalBalanceChange;
        const now = Date.now();

        // BOLT: Throttled balance logging. Balance updates can be extremely frequent on active accounts.
        // We only log if it's been 10s or if there's a non-zero balance change (funding/fill).
        if (bc !== 0 || now - this.lastBalanceLogTs > 10000) {
          const liveBalMsg = `[Lifecycle] Received real-time balance update: ${nb} USDT (Reason: ${reason}, Delta: ${bc})`;
          this.logger.log(liveBalMsg);
          this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
            msg: liveBalMsg,
            level: "info",
          });
          this.lastBalanceLogTs = now;
        }

        this.sessionState.balanceLive = nb;
        if (this.sessionState.config?.paper_mode) {
          this.sessionState.balancePaper = nb; // Sync Paper to Live on real-time update only if paper_mode is active
        }
        const prevBalance = this.sessionState.lastExchangeBalance;
        this.sessionState.lastExchangeBalance = nb;
        this.sessionState.lastUdsBalanceUpdate = Date.now();

        // Mark all current trades as UDS-confirmed since we have a fresh absolute balance update
        if (this.sessionState.activeTrades) {
          for (const t of this.sessionState.activeTrades) {
            this.sessionState.udsConfirmedClosedTrades.add(t.id);
          }
        }
        if (this.sessionState.closedTrades) {
          for (const t of this.sessionState.closedTrades) {
            this.sessionState.udsConfirmedClosedTrades.add(t.id);
          }
        }

        // Broadcast balance update to frontend
        // BOLT/Eco: Only egress when the balance actually changed. ACCOUNT_UPDATE fires per
        // fill and can include a USDT entry even when nothing materially changed for this
        // asset, so avoid needless frontend broadcasts (consistent with the eco/egress policy).
        if (bc !== 0 || nb !== prevBalance) {
          this.broadcastService.broadcast('balance_update', { balance: nb });
        }

        // CHRONOS: Handle Authoritative Funding Fee Attribution
        // When reason is FUNDING_FEE, the 'bc' field contains the net funding impact.
        // We attribute this to active trades to ensure PnL and session stats remain accurate.
        if (reason === "FUNDING_FEE" && bc !== 0) {
          this.attributeFundingFee(bc, data.a.P || []);
        }
      }
    }
    // Real-time Position Tracking (Zero Weight)
    if (data.a.P) {
      for (const pos of data.a.P) {
        const symbol = pos.s;
        const amount = parseFloat(pos.pa);
        const entryPrice = parseFloat(pos.ep);

        const prevPos = this.sessionState.realTimePositions.get(symbol);
        this.sessionState.realTimePositions.set(symbol, { amount, entryPrice });

        this.logger.debug(
          `[Lifecycle] Real-time position update for ${symbol}: ${amount} @ ${entryPrice}`,
        );

        let trade = this.sessionState.activeTrades.find(
          (t) => t.symbol === symbol,
        );

        // SRE: Race condition guard - check in-flight entries if not in active list
        if (!trade && amount !== 0) {
          trade = this.positionTracker.getInFlightEntry(symbol);
          if (trade) {
            this.logger.debug(
              `[Lifecycle] [Sync] Matched in-flight entry for ${symbol} in ACCOUNT_UPDATE.`,
            );
          }
        }

        // Real-time Quantity & Price Sync: Update active trade from UDS ACCOUNT_UPDATE
        if (trade && amount !== 0) {
          const absoluteAmount = Math.abs(amount);
          const tradeIdShort8 = (trade.id || "N/A").substring(0, 8);

          // CHRONOS: If this was an in-flight entry, promote it to active status immediately
          // now that we have exchange-confirmed position data.
          if (!this.sessionState.activeTrades.find((t) => t.id === trade!.id)) {
            this.logger.log(
              `[${tradeIdShort8}] [Sync] Promoting in-flight entry for ${symbol} to active list via ACCOUNT_UPDATE.`,
            );
            this.positionTracker.addTrade(trade);
          }

          // Authoritative Entry Price Sync
          if (
            entryPrice > 0 &&
            Math.abs(trade.entry_price - entryPrice) > 0.00000001
          ) {
            this.logger.log(
              `[${tradeIdShort8}] [Sync] Updating entry price from ACCOUNT_UPDATE for ${symbol}: ${trade.entry_price} -> ${entryPrice}`,
            );
            trade.entry_price = entryPrice;
          }

          // Authoritative Quantity Sync
          if (Math.abs(trade.qty - absoluteAmount) > 0.00000001) {
            // CHRONOS: Authoritative sync is mandatory.
            // We no longer ignore quantity decreases outside of 'closing' state,
            // as this creates ghost positions when users manually reduce positions on exchange.
            this.logger.log(
              `[${tradeIdShort8}] [Sync] Updating quantity from ACCOUNT_UPDATE for ${symbol}: ${trade.qty} -> ${absoluteAmount}`,
            );
            trade.qty = absoluteAmount;
            this.eventEmitter.emit(ENGINE_EVENTS.QUANTITY_SYNC, {
              symbol,
              qty: absoluteAmount,
            });
          }
        }

        // ZERO-WEIGHT RECONCILIATION: If position reaches 0 and we have an active trade,
        // it means it was closed on exchange (SL, TP, or manual).
        const hasActiveTrade = this.sessionState.activeTrades?.some(
          (t) => t.symbol === symbol,
        );
        if (amount === 0 && (!prevPos || prevPos.amount !== 0 || hasActiveTrade)) {
          let tEntity = this.sessionState.activeTrades?.find(
            (t) => t.symbol === symbol,
          );
          if (!tEntity && this.sessionState.closedTrades) {
            tEntity = this.sessionState.closedTrades.find(
              (t) => t.symbol === symbol && t.status !== "OPEN",
            );
          }
          if (tEntity) {
            this.sessionState.udsConfirmedClosedTrades.add(tEntity.id);
            this.logger.debug(
              `[UDS] Marked trade ${tEntity.id} for ${symbol} as UDS-confirmed closed.`,
            );
          }

          // SRE: Race condition guard - ignore UDS zero-fills if we are already in the process of entering, ratcheting, or closing
          if (
            this.orderManager.isRatcheting(symbol) ||
            this.positionTracker.isEntering(symbol) ||
            this.positionTracker.isClosing(symbol)
          ) {
            this.logger.debug(
              `[UDS] Ignoring zero-amount update for ${symbol} during lifecycle transition.`,
            );
            continue;
          }

          const trade = this.sessionState.activeTrades.find(
            (t) => t.symbol === symbol,
          );
          if (trade) {
            const tradeIdShort8 = (trade.id || "N/A").substring(0, 8);

            // CHRONOS/Race: When a position hits zero on exchange, an SL hit (with an attached
            // stop order) usually arrives its ORDER_TRADE_UPDATE slightly AFTER the
            // ACCOUNT_UPDATE. We delay the zero-weight reconciliation briefly to let the richer,
            // flag-correct ORDER_TRADE_UPDATE execute first and provide an authoritative fill
            // price. Previously this was a fixed 100ms guess and trades WITHOUT a stop order got
            // 0ms, reintroducing the race. We now use a modest, named-constant delay uniformly so
            // any concurrent order-fill + zero-position event is reconciled after the UDS settles.
            const delayMs = ENGINE_CONSTANTS.UDS_ZERO_POSITION_DELAY_MS;

            const executeSyncClose = () => {
              if (!this.running) return;

              const currentTrade = this.sessionState.activeTrades.find(t => t.symbol === symbol);
              if (!currentTrade) {
                this.logger.debug(`[${tradeIdShort8}] [Lifecycle] Trade for ${symbol} already removed. Skipping zero-weight closure.`);
                return;
              }

              if (this.positionTracker.isClosing(symbol)) {
                this.logger.debug(`[${tradeIdShort8}] [Lifecycle] Trade for ${symbol} is already closing. Skipping zero-weight closure.`);
                return;
              }

              this.logger.log(
                `[${tradeIdShort8}] [Lifecycle] Executing scheduled zero-weight reconciliation for ${symbol}.`,
              );
              this.eventEmitter.emit(ENGINE_EVENTS.EXCHANGE_CLOSE, {
                symbol,
                exitPrice: 0, // Will use ticker fallback
                reason: EXIT_REASONS.EXCHANGE_SYNC,
                isReconciliation: true,
              });
            };

            if (delayMs > 0) {
              this.logger.log(
                `[${tradeIdShort8}] [Lifecycle] Scheduled zero-weight reconciliation for ${symbol} in ${delayMs}ms to let concurrent SL trade updates arrive first.`,
              );
              setTimeout(executeSyncClose, delayMs);
            } else {
              this.logger.log(
                `[${tradeIdShort8}] [Lifecycle] Zero-weight reconciliation: Position for ${symbol} reached zero on exchange. Triggering immediate local closure.`,
              );
              executeSyncClose();
            }
          }
        }
      }
    }
  }

  public async startUserDataStream(
    bc: any,
    isReconnect = false,
    isTransition = false,
  ) {
    if (!bc || !this.running) return;

    // SRE: Immunity check. If we are currently banned, don't try to start UDS
    if (this.sessionState.isBanned()) return;

    if (this.isUdsStarting) {
      this.logger.debug(
        "[UDS] Connection attempt already in progress. Skipping.",
      );
      return;
    }
    this.isUdsStarting = true;

    // SRE: Critical guard - if IP is banned, do not even attempt UDS start to prevent chain reaction
    // SRE Overwatch: startUserDataStream is whitelisted as IMMUNE in the gateway, but we still log warning if over limit.
    const currentWeight = this.sessionState.binanceRateLimit.used_1m;
    const limit =
      this.sessionState.binanceRateLimit.limit ||
      ENGINE_CONSTANTS.BINANCE_RATE_LIMIT_DEFAULT;
    if (currentWeight >= limit) {
      this.logger.warn(
        `[UDS] IP Rate limit exceeded (${currentWeight}/${limit}). Proceeding with IMMUNE infrastructure call.`,
      );
    }

    try {
      this.monitoringService.incrementApiRequests();
      const res = await bc.restAPI.startUserDataStream();
      if (!res || !res.data)
        throw new Error(
          "Failed to start user data stream: No response from Binance",
        );

      const resData = (await res.data()) as BinanceListenKeyResponse;
      const newListenKey = resData.listenKey;

      const oldWs = this.userDataWs;
      const oldListenKey = this.listenKey;

      // SRE FIX: Always rebuild the socket on reconnection attempt to handle silent network-level stalls,
      // even if the listenKey string remains unchanged.
      // BOLT: Only disconnect immediately if NOT a transition. Transitions keep old one alive for 30s.
      if (isReconnect && oldWs && !isTransition) {
        this.logger.log(
          "[UDS] Force-rebuilding User Data Stream socket to resolve potential stall.",
        );
        try {
          oldWs.disconnect();
        } catch (e) {}
      }

      this.listenKey = newListenKey;
      this.userDataWs = await bc.websocketStreams.connect({
        stream: this.listenKey,
      });
      this.isUdsConnected = true;
      this.udsReconnectAttempts = 0;
      this.logger.log(`[UDS-DIAGNOSTIC] Successfully connected to stream with listenKey: ${this.listenKey?.substring(0, 5)}...`);

      this.monitoringService.setUdsStatus("CONNECTED");

      const currentWs = this.userDataWs;

      currentWs.on("error", (err: any) => {
        if (this.userDataWs !== currentWs) return;
        this.isUdsConnected = false;
        this.monitoringService.setUdsStatus("DISCONNECTED");
        this.logger.error(
          `User Data Stream error: ${err.message || String(err)}`,
        );
      });

      currentWs.on("close", () => {
        if (this.userDataWs !== currentWs) {
          this.logger.log("[UDS] Old stream closed gracefully.");
          return;
        }
        this.isUdsConnected = false;
        this.monitoringService.setUdsStatus("DISCONNECTED");
        if (this.running) {
          this.udsReconnectAttempts++;

          if (this.udsReconnectAttempts > 5) {
            const alertMsg = `CRITICAL: User Data Stream failed to reconnect after ${this.udsReconnectAttempts} attempts. Account monitoring is degraded.`;
            this.logger.error(alertMsg);
            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
              msg: alertMsg,
              level: "error",
            });
            this.eventEmitter.emit(ENGINE_EVENTS.ALERT, {
              level: "error",
              title: "UDS Reconnect Failure",
              message:
                "Account stream is offline after multiple retries. Positions might be unprotected.",
            });
          }

          this.logger.warn(
            `User Data Stream closed unexpectedly. Reconnecting (Attempt ${this.udsReconnectAttempts})...`,
          );

          // BOLT: Use exponential backoff for reconnect attempts to avoid hammering during outages
          const delay = Math.min(
            30000,
            5000 * Math.pow(2, Math.max(0, this.udsReconnectAttempts - 1)),
          );
          setTimeout(() => {
            if (this.running && !this.isUdsConnected) {
              this.startUserDataStream(bc, true).catch(() => {});
            }
          }, delay);
        }
      });

      currentWs.on("pong", () => {
        if (this.userDataWs !== currentWs) return;
        // REDUCE LOG NOISE: Silence heartbeat PONGs
        // this.logger.debug('[UDS] WebSocket PONG received. Heartbeat confirmed.');
        this.monitoringService.recordUdsPing();
        // CITADEL: Proactively ensure status is CONNECTED upon PONG to recover from transient LAGGING state
        this.monitoringService.setUdsStatus("CONNECTED");
      });

      currentWs.on("message", async (payload: any) => {
        if (this.userDataWs !== currentWs) return;
        this.monitoringService.recordUdsPing();
        try {
          // SDK WebsocketStreams.connect returns a connection that emits 'message' with the already parsed object or string
          let data =
            typeof payload === "string" ? JSON.parse(payload) : payload;

          this.logger.debug(`[UDS-DIAGNOSTIC] Message received: ${JSON.stringify(data).substring(0, 100)}`);

          // ENHANCED DIAGNOSTICS: Log every message received on UDS in live mode
          const isLive = this.sessionState.config?.trading_mode === 'live' || (!this.sessionState.config?.paper_mode && this.sessionState.config?.trading_mode !== 'testnet');
          if (isLive) {
            this.logger.log(`[UDS-DIAGNOSTIC] Live mode message received: ${JSON.stringify(data).substring(0, 200)}`);
          }

          // UDS HARDENING: Handle both direct and combined stream formats (unwrap .data if present)
          if (data && data.data && data.stream) {
            data = data.data;
          }

          // NORMALIZE TRADE_LITE and ALGO_UPDATE to ORDER_TRADE_UPDATE
          if (data && data.e === "TRADE_LITE") {
            this.logger.log(`[UDS] Normalizing TRADE_LITE event to ORDER_TRADE_UPDATE for ${data.s}`);
            data = this.normalizeTradeLite(data);
          } else if (data && data.e === "ALGO_UPDATE") {
            this.logger.log(`[UDS] Normalizing ALGO_UPDATE event to ORDER_TRADE_UPDATE for ${data.o?.s}`);
            data = this.normalizeAlgoUpdate(data);
          }

          if (data.e === "ACCOUNT_UPDATE" && data.a) {
            this.logger.log(`[UDS] Successfully received and processing ACCOUNT_UPDATE event (Reason: ${data.a.m}).`);
            if (this.isBuffering) {
              this.logger.debug(
                `[Chronos] Buffering ACCOUNT_UPDATE event (Reason: ${data.a.m})`,
              );
              this.eventBuffer.push(data);
            } else {
              this.handleAccountUpdate(data);
            }
          } else if (data.e === "ORDER_TRADE_UPDATE") {
            this.logger.log(`[UDS] Successfully received and processing ORDER_TRADE_UPDATE event for ${data.o?.s} (Status: ${data.o?.X}, ExecutionType: ${data.o?.x}).`);
            if (this.isBuffering) {
              this.logger.debug(
                `[Chronos] Buffering ORDER_TRADE_UPDATE event for ${data.o?.s}`,
              );
              this.eventBuffer.push(data);
            } else {
              // REDUCE LOG NOISE: OrderManagerService already logs this with more detail
              this.eventEmitter.emit("binance.order_update", data);
            }
          } else if (data.e === "MARGIN_CALL") {
            this.logger.warn(`[UDS] CRITICAL: MARGIN_CALL event received from exchange!`);
            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
              msg: `CRITICAL RISK ALERT: Margin call received from Binance! Please check your account margin levels immediately. Details: ${JSON.stringify(sanitize(data))}`,
              level: 'error'
            });
            this.eventEmitter.emit(ENGINE_EVENTS.ALERT, {
              level: 'error',
              title: 'Margin Call',
              message: 'Binance is warning of low margin. Risk of immediate liquidation.'
            });
          } else if (data.e === "ACCOUNT_CONFIG_UPDATE") {
            this.logger.log(`[UDS] ACCOUNT_CONFIG_UPDATE event received: ${JSON.stringify(sanitize(data))}`);
            if (data.ac) {
              const symbol = data.ac.s;
              const leverage = data.ac.l;
              if (symbol && leverage) {
                this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
                  msg: `[UDS] Sync: Account configuration updated for ${symbol}. Leverage adjusted to ${leverage}x.`,
                  level: 'info'
                });
              }
            }
          } else if (data.e === "listenKeyExpired") {
            this.logger.warn(
              "[Lifecycle] ListenKey expired, restarting user data stream...",
            );
            this.startUserDataStream(bc, true).catch(() => {});
          } else {
            // Log unknown event types for debugging
            if (isLive) {
              this.logger.log(`[UDS-DIAGNOSTIC] Unhandled event type in live mode: ${data.e || 'unknown'}, full: ${JSON.stringify(data).substring(0, 200)}`);
            } else {
              this.logger.debug(`[UDS-DIAGNOSTIC] Unhandled event type: ${data.e || 'unknown'}`);
            }
          }
        } catch (err) {
          this.logger.debug(
            `Error processing user data WS message: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
      const subMsg = `[Lifecycle] Subscribing to User Data Stream with listenKey: ${this.listenKey?.substring(0, 10)}...`;
      this.logger.log(subMsg);
      this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
        msg: subMsg,
        level: "info",
      });
      // Not needed for new SDK as connect({ stream: listenKey }) already handles the subscription
      // this.userDataWs.userData(this.listenKey);

      // Transition handling for proactive 24h reconnect or planned swaps
      if (isTransition && oldWs) {
        this.logger.log(
          "[Lifecycle] Transitioning to new User Data Stream. Closing old stream in 30s...",
        );
        setTimeout(() => {
          try {
            // Close the old socket if it hasn't been closed yet
            oldWs.disconnect();
            // BOLT: Only close key if different. In case of expiry, Binance already closed it.
            if (oldListenKey && oldListenKey !== this.listenKey) {
              this.logger.debug(
                `[UDS] Closing old listenKey: ${oldListenKey.substring(0, 10)}...`,
              );
              bc.restAPI
                .closeUserDataStream({ listenKey: oldListenKey })
                .catch(() => {});
            }
          } catch (e) {}
        }, 30000);
      }

      if (this.listenKeyKeepAlive) clearInterval(this.listenKeyKeepAlive);

      // SRE: Independent UDS liveness check (Stall Detection)
      if (this.udsLivenessCheck) clearInterval(this.udsLivenessCheck);
      this.udsLivenessCheck = setInterval(() => {
        if (!this.running || !this.isUdsConnected) return;

        // SRE: Proactive WebSocket ping to confirm liveness on idle accounts
        try {
          if (
            this.userDataWs &&
            typeof this.userDataWs.pingServer === "function"
          ) {
            this.logger.debug("[UDS] Dispatching proactive WebSocket ping...");
            this.userDataWs.pingServer();
          }
        } catch (e) {
          this.logger.debug(
            `[SRE] Failed to dispatch WebSocket ping: ${e instanceof Error ? e.message : String(e)}`,
          );
        }

        const metrics = this.monitoringService.getMetrics();
        const lastPing = metrics.application.last_uds_ping_sec || 0;
        const hasActiveTrades = this.positionTracker.activeList().length > 0;

        // SRE Optimization: Threshold increased to 300s (5m).
        // On idle accounts, message silence is expected. We only force-reconnect if there are active trades
        // that require real-time monitoring, OR if the stall is excessive (>10m).
        const STALL_THRESHOLD = 300;
        const MAX_IDLE_SILENCE = 600;

        const isStalled =
          (hasActiveTrades && lastPing > STALL_THRESHOLD) ||
          lastPing > MAX_IDLE_SILENCE;

        if (
          metrics.application.exchange_uds_status === "LAGGING" &&
          isStalled
        ) {
          this.logger.warn(
            `[SRE] User Data Stream stall detected (LastPing=${lastPing}s, ActiveTrades=${hasActiveTrades}). Force-reconnecting...`,
          );
          this.startUserDataStream(bc, true).catch(() => {});
        }
        // HEARTBEAT: Explicit debug log for UDS health observability
        // BOLT: Only log heartbeats at DEBUG level if disconnected or stalled (>60s) to keep logs clean
        if (!this.isUdsConnected || lastPing > 60) {
          this.logger.debug(
            `[SRE] UDS Heartbeat: Status=${this.isUdsConnected ? "CONNECTED" : "DISCONNECTED"}, LastPing=${lastPing}s, ActiveTrades=${hasActiveTrades}`,
          );
        }
      }, 60000);

      const startTime = Date.now();
      this.listenKeyKeepAlive = setInterval(async () => {
        if (!this.listenKey || !this.running) return;

        const ageMs = Date.now() - startTime;
        // Finding 9: Proactive 24h reconnect at 23h 50m
        if (ageMs > 23 * 60 * 60 * 1000 + 50 * 60 * 1000) {
          this.logger.log(
            "[Lifecycle] Proactive 24h User Data Stream refresh initiated...",
          );
          this.startUserDataStream(bc, true, true).catch((err) => {
            this.logger.error(`Proactive UDS refresh failed: ${err.message}`);
          });
          return;
        }

        try {
          this.monitoringService.incrementApiRequests();
          await bc.restAPI.keepaliveUserDataStream({
            listenKey: this.listenKey,
          });
        } catch (err: any) {
          const msg = err.message || "";
          const errCode = err.code || (err.response?.data?.code) || 0;
          const isExpired = errCode === -1125 || msg.includes("-1125") || msg.toLowerCase().includes("does not exist") || msg.toLowerCase().includes("expired");

          // BOLT: Suppress "IP banned" errors during keepalive as they are expected during a ban
          // and handled by the centralized request queue.
          if (msg.includes("IP banned")) {
            this.logger.debug(`Keepalive suppressed during active IP ban.`);
          } else if (isExpired) {
            this.logger.error(`[Chronos] User Data Stream listenKey expired/invalidated (Code: ${errCode}, Msg: ${msg}). Rebuilding stream immediately...`);
            this.startUserDataStream(bc, true).catch((streamErr) => {
              this.logger.error(`[Chronos] Failed to rebuild user data stream after keepalive expiration: ${streamErr.message}`);
            });
          } else {
            this.logger.debug(`Error keeping alive user data stream: ${msg}`);
          }
        }
      }, ENGINE_CONSTANTS.USER_DATA_KEEPALIVE_MS);
    } catch (e) {
      if (!isReconnect && !isTransition) throw e;
      this.logger.error(
        `Failed to refresh user data stream: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      this.isUdsStarting = false;
    }
  }

  private normalizeTradeLite(data: any): any {
    if (!data) return data;
    return {
      e: "ORDER_TRADE_UPDATE",
      E: data.E || Date.now(),
      T: data.T || Date.now(),
      o: {
        s: data.s,
        c: data.c,
        S: data.S,
        o: "MARKET",
        f: "GTC",
        q: data.q || "0",
        p: data.p || "0",
        ap: data.L || "0",
        sp: "0",
        x: "TRADE",
        X: "FILLED",
        i: Number(data.i || 0),
        l: data.l || "0",
        z: data.l || "0",
        L: data.L || "0",
        N: "USDT",
        n: "0",
        t: Number(data.t || 0),
        m: !!data.m,
        R: true,
        wt: "MARK_PRICE",
        ot: "MARKET",
        ps: "BOTH",
        cp: false,
        rp: "0"
      }
    };
  }

  private normalizeAlgoUpdate(data: any): any {
    if (!data || !data.o) return data;
    const o = data.o;
    return {
      e: "ORDER_TRADE_UPDATE",
      E: data.E || Date.now(),
      T: data.T || Date.now(),
      o: {
        s: o.s,
        c: o.caid || o.clientAlgoId || "",
        S: o.S,
        o: o.o || "STOP_MARKET",
        f: o.f || "GTC",
        q: o.q || "0",
        p: "0",
        ap: "0",
        sp: o.sp || o.stopPrice || "0",
        x: o.X || "NEW",
        X: o.X || "NEW",
        i: Number(o.aid || o.algoId || 0),
        l: "0",
        z: "0",
        L: "0",
        N: "USDT",
        n: "0",
        t: 0,
        m: false,
        R: true,
        wt: "MARK_PRICE",
        ot: o.o || "STOP_MARKET",
        ps: o.ps || "BOTH",
        cp: false,
        rp: "0"
      }
    };
  }
}
