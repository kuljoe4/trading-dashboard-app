import {
  Injectable,
  Logger,
  OnModuleInit,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, In } from "typeorm";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { Session as SessionEntity } from "../models/entities/Session.entity";
import { TradeEntity } from "../models/entities/Trade.entity";
import { TERMINAL_STATUSES } from "../models/entities/constants";
import { Log as LogEntity } from "../models/entities/Log.entity";
import { BalanceHistory as BalanceHistoryEntity } from "../models/entities/BalanceHistory.entity";
import { SessionConfig } from "../models/SessionConfig";
import { TradingSessionService } from "../engine/trading_session.service";
import { OrderManagerService } from "../engine/orderManager";
import { ENGINE_EVENTS } from "../engine/events";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { AuditLogService } from "./audit-log.service";
import { Trade } from "../models/Trade";
import { v4 as uuid } from "uuid";
import { Settings as SettingsEntity } from "../models/entities/Settings.entity";
import { decrypt } from "../lib/crypto";
import { ConfigValidationException } from "../lib/exceptions";
import { BinanceClientFactory } from "../lib/binanceClientFactory";
import { AnalyticsService } from "../engine/analytics.service";
import { RrOptimizationService } from "../engine/rr-optimization.service";
import { MarketFeedService } from "../engine/market_feed.service";
import {
  updateLogLevels,
  sanitize,
  formatValidationErrors,
} from "../lib/logger";
import { roundEight } from "../lib/math";
import {
  CONFIG_LIMITS,
  EXIT_REASONS,
  ENGINE_CONSTANTS,
} from "../models/constants";

@Injectable()
export class SessionService implements OnModuleInit {
  private readonly logger = new Logger(SessionService.name);

  private sessionRunning = false;
  private currentSessionId: string | null = null;
  private wsBroadcaster: (data: any) => void = () => {};

  private analyticsCache: { data: any; ts: number } | null = null;
  private readonly CACHE_TTL_MS = 60000; // 1 minute

  // DATA-CONSISTENCY: Fields that cannot be modified while a session is active
  private static readonly IMMUTABLE_SESSION_FIELDS = [
    "trading_mode",
    "paper_mode",
    "paper_starting_balance",
    "testnet_starting_balance",
    "live_starting_balance",
  ];

  // SENTINEL: In-memory tracking to prevent database-heavy count() and log spamming
  private logRateLimits = new Map<string, { count: number; resetAt: number }>();
  private sessionLogCounts = new Map<string, number>();
  private adoptingSymbols: Set<string> = new Set();

  constructor(
    @InjectRepository(SessionEntity)
    private sessionRepository: Repository<SessionEntity>,
    @InjectRepository(TradeEntity)
    private tradeRepository: Repository<TradeEntity>,
    @InjectRepository(LogEntity)
    private logRepository: Repository<LogEntity>,
    @InjectRepository(SettingsEntity)
    private settingsRepository: Repository<SettingsEntity>,
    @InjectRepository(BalanceHistoryEntity)
    private balanceHistoryRepository: Repository<BalanceHistoryEntity>,
    private tradingSessionService: TradingSessionService,
    @Inject(forwardRef(() => OrderManagerService))
    private orderManager: OrderManagerService,
    private marketFeed: MarketFeedService,
    private eventEmitter: EventEmitter2,
    private analyticsService: AnalyticsService,
    private rrOptimizationService: RrOptimizationService,
    private binanceClientFactory: BinanceClientFactory,
    private readonly auditLog: AuditLogService,
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    this.logger.log("SessionService initializing...");

    // DEPLOY-03: Log truncated DB host to help verify environment isolation
    try {
      const dbUrl = this.configService.get<string>("DATABASE_URL");
      if (dbUrl) {
        // Robust parsing using URL constructor to handle special characters in passwords
        const url = new URL(dbUrl);
        const dbHost = url.hostname || "unknown";
        const truncatedHost =
          dbHost.length > 8
            ? `***${dbHost.substring(dbHost.length - 8)}`
            : dbHost;
        this.logger.log(
          `[Diagnostic] Connected to Database Host: ${truncatedHost}`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `[Diagnostic] Could not identify DB host: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // RESEARCH: Load persistent API ban status on startup to prevent immediate retry cycles
    try {
      const settings = await this.settingsRepository.findOne({
        where: { id: "default" },
      });
      if (
        settings &&
        settings.api_ban_until &&
        Number(settings.api_ban_until) > Date.now()
      ) {
        const remaining = Math.round(
          (Number(settings.api_ban_until) - Date.now()) / 60000,
        );
        this.logger.warn(
          `Resuming with active API Ban/Cooldown. Remaining: ${remaining}m. Reason: ${settings.api_ban_reason}`,
        );

        // Push to trading session service if it's already instantiated
        this.tradingSessionService.handleApiLimitReached({
          type: "BAN",
          message: settings.api_ban_reason || "Persistent Ban",
          until: Number(settings.api_ban_until),
        });
      }
    } catch (e) {
      this.logger.error(
        `Failed to load persistent ban status: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    // SEC-02: Cleanup old data on startup and periodically
    await this.cleanupOldData();
    setInterval(
      () =>
        this.cleanupOldData().catch((e) =>
          this.logger.error(`Periodic cleanup failed: ${e.message}`),
        ),
      12 * 60 * 60 * 1000,
    );

    this.logger.log("Checking security configurations...");
    // DEPLOY-02: Check ENCRYPTION_KEY and ADMIN_API_KEY in production
    // Note: We only log errors here to avoid boot loops. Enforcement happens at the operation level.
    if (process.env.NODE_ENV === "production") {
      if (!process.env.ENCRYPTION_KEY) {
        this.logger.error(
          "CRITICAL: ENCRYPTION_KEY is not set in production! App will fail on sensitive operations.",
        );
      }
      if (!process.env.ADMIN_API_KEY) {
        this.logger.error(
          "CRITICAL: ADMIN_API_KEY is not set in production! App is UNPROTECTED.",
        );
      }
    }

    // Ensure default settings exist
    this.logger.log("Ensuring default settings exist...");
    const settings = await this.settingsRepository.findOne({
      where: { id: "default" },
    });
    if (!settings) {
      this.logger.log("Initializing default settings...");
      await this.settingsRepository.save(
        this.settingsRepository.create({
          id: "default",
          paper_balance: 10000.0,
          testnet_balance: 0,
          live_balance: 0,
        }),
      );
    }

    // Cleanup any sessions marked as running in the database on startup
    // BOLT: Optimize startup cleanup with a single bulk update instead of a loop.
    // Note: Associated open trades are flagged with is_reconciliation: true during startSession().
    this.logger.log("Cleaning up stale running sessions...");
    const updateResult = await this.sessionRepository.update(
      { running: true },
      {
        running: false,
        endTime: new Date(),
      },
    );
    if (updateResult.affected && updateResult.affected > 0) {
      this.logger.verbose(
        `Cleaned up ${updateResult.affected} stale running sessions`,
      );
    }

    // DATA-03: One-time population of strategy_label for legacy trades to fix 'Uncategorized' issue
    this.logger.log("Populating strategy_label for legacy trades...");
    try {
      const tradeUpdateResult = await this.tradeRepository
        .createQueryBuilder()
        .update(TradeEntity)
        .set({ strategy_label: "Momentum Strategy" })
        .where("strategy_label IS NULL")
        .execute();
      if (tradeUpdateResult.affected && tradeUpdateResult.affected > 0) {
        this.logger.log(
          `Initialized strategy_label for ${tradeUpdateResult.affected} legacy trades`,
        );
      }
    } catch (e: any) {
      this.logger.error(
        `Failed to initialize legacy trade labels: ${e.message}`,
      );
    }

    this.logger.log("Wiring balance and trade updates...");
    // Wire balance updates to persistence (legacy/standalone updates)
    this.tradingSessionService.setBalanceUpdateCallback(
      async (balance, pnl) => {
        const sessionId = this.currentSessionId;
        if (sessionId && pnl === 0) {
          const queryRunner =
            this.sessionRepository.manager.connection.createQueryRunner();
          await queryRunner.connect();
          await queryRunner.startTransaction();
          try {
            // Lock Session row to ensure consistency and fetch mode
            const session = await queryRunner.manager.findOne(SessionEntity, {
              where: { id: sessionId },
              lock: { mode: "pessimistic_write" },
              select: ["id", "tradingMode", "paperMode", "config"],
            });

            if (session) {
              const mode =
                session.tradingMode || (session.paperMode ? "paper" : "live");

              // DATA-CONSISTENCY: Use trade summation for PnL in ALL modes (including Paper)
              // to ensure consistency and prevent corruption from external balance adjustments.
              const aggregation = await queryRunner.manager
                .createQueryBuilder(TradeEntity, "trade")
                .select("SUM(trade.pnl)", "sum")
                .where("trade.sessionId = :sessionId", { sessionId })
                .andWhere("trade.status IN (:...statuses)", {
                  statuses: [...TERMINAL_STATUSES, "OPEN"],
                })
                .getRawOne();

              const realizedPnl = roundEight(Number(aggregation?.sum || 0));

              await queryRunner.manager.update(SessionEntity, sessionId, {
                balance,
                totalPnl: realizedPnl,
              });

              const updateData: any = {};
              if (mode === "paper") updateData.paper_balance = balance;
              else if (mode === "testnet") updateData.testnet_balance = balance;
              else if (mode === "live") updateData.live_balance = balance;
              await queryRunner.manager.update(
                SettingsEntity,
                "default",
                updateData,
              );
            }
            await queryRunner.commitTransaction();
          } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error(
              `Failed to sync standalone balance for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
            );
          } finally {
            await queryRunner.release();
          }
        }
      },
    );

    // Wire trade updates to persistence
    this.tradingSessionService.setTradeUpdateCallback(
      async (trade, balance) => {
        await this.saveTradeAtomic(trade, balance);
      },
    );

    this.logger.log("SessionService initialization complete.");
  }

  @OnEvent(ENGINE_EVENTS.LOG_MESSAGE)
  async handleEngineLog(payload: {
    msg: string;
    level: "info" | "warn" | "error";
  }) {
    await this.logMessage(payload.msg, payload.level);
  }

  private validateTrade(trade: any): boolean {
    return (
      trade.symbol != null &&
      trade.entry_price != null &&
      !isNaN(Number(trade.entry_price)) &&
      trade.qty != null &&
      !isNaN(Number(trade.qty)) &&
      trade.status != null
    );
  }

  private saveTradePromiseChain: Promise<any> = Promise.resolve();

  async saveTradeAtomic(trade: any, balance: number) {
    // Audit Item 13: Mutex/Promise chain to prevent race conditions during atomic saves
    return (this.saveTradePromiseChain = this.saveTradePromiseChain
      .then(() => this.executeSaveTradeAtomic(trade, balance))
      .catch((e) => {
        this.logger.error(`Atomic save failed in chain: ${e.message}`);
        throw e;
      }));
  }

  private async executeSaveTradeAtomic(trade: any, balance: number) {
    if (!this.validateTrade(trade)) {
      this.logger.warn(
        `Attempted to save invalid trade ${trade.symbol}, skipping.`,
      );
      return;
    }

    const sessionId = this.currentSessionId || trade.sessionId;
    if (!sessionId) {
      this.logger.warn(
        `Cannot save trade ${trade.symbol}: No sessionId found.`,
      );
      return;
    }

    const queryRunner =
      this.sessionRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 0. Lock Session row to serialize all updates for this session and fetch metadata
      const session = await queryRunner.manager.findOne(SessionEntity, {
        where: { id: sessionId },
        lock: { mode: "pessimistic_write" },
        select: ["id", "tradingMode", "paperMode", "config"],
      });

      if (!session) {
        throw new Error(`Session ${sessionId} not found during atomic save.`);
      }

      // 1. Save Trade record
      const persistenceTrade = { ...trade };
      if (trade.status === "OPEN") {
        // For OPEN trades, we save the current 'realized' portion (fees + funding)
        // to ensure correct appliedPnL initialization on restart.
        // Unrealized price PnL is not included in trade.pnl for open trades in the engine.
        persistenceTrade.pnl = Number(trade.pnl || 0);
        persistenceTrade.pnl_pct = 0;
      }

      const tradeEntity = this.tradeRepository.create({
        ...persistenceTrade,
        exit_signal_type: trade.exit_signal_type,
        exit_signal_reason: trade.exit_signal_reason,
        exit_signals_status: trade.exit_signals_status,
        entry_signal_type: trade.entry_signal_type,
        entry_signal_confidence: trade.entry_signal_confidence,
        mark_price: trade.mark_price,
        last_price: trade.last_price,
        close_attempts: trade.close_attempts || 0,
        last_close_attempt_ts: trade.last_close_attempt_ts,
        close_blocked: !!trade.close_blocked,
        illiquid_blocked: !!trade.illiquid_blocked,
        _sig_json: trade._sig_json,
        sessionId,
      });
      await queryRunner.manager.save(TradeEntity, tradeEntity);

      // 2. Update Session PnL and Balance
      // DATA-CONSISTENCY: Use trade summation for PnL in ALL modes (including Paper)
      // to ensure consistency and prevent corruption from manual balance adjustments.
      // This ensures that fees and funding from active trades are reflected in totalPnl immediately.
      const aggregation = await queryRunner.manager
        .createQueryBuilder(TradeEntity, "trade")
        .select("SUM(trade.pnl)", "sum")
        .where("trade.sessionId = :sessionId", { sessionId })
        .andWhere("trade.status IN (:...statuses)", {
          statuses: [...TERMINAL_STATUSES, "OPEN"],
        })
        .getRawOne();

      const realizedPnl = roundEight(Number(aggregation?.sum || 0));

      await queryRunner.manager.update(SessionEntity, sessionId, {
        balance,
        totalPnl: realizedPnl,
      });

      // 3. Update Global Settings and record History for all modes
      if (session) {
        const mode =
          session.tradingMode || (session.paperMode ? "paper" : "live");
        const updateData: any = {};
        if (mode === "paper") updateData.paper_balance = balance;
        else if (mode === "testnet") updateData.testnet_balance = balance;
        else if (mode === "live") updateData.live_balance = balance;

        await queryRunner.manager.update(SettingsEntity, "default", updateData);

        // Record Balance Snapshot
        const snapshot = this.balanceHistoryRepository.create({
          timestamp: new Date(),
          balance: balance,
          pnl: roundEight(trade.pnl || 0),
          type: trade.status === "OPEN" ? "TRADE_OPEN" : "TRADE_CLOSE",
          sessionId: sessionId,
          tradeId: trade.id,
          tradingMode: mode as any,
        });
        await queryRunner.manager.save(BalanceHistoryEntity, snapshot);
      }

      await queryRunner.commitTransaction();
      this.logger.verbose(
        `Transaction committed: Saved trade ${trade.symbol} (${trade.status}) and updated session ${sessionId}`,
      );
    } catch (error) {
      await queryRunner.rollbackTransaction();
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[CRITICAL] Transaction rolled back for ${trade.symbol}: ${errorMsg}`,
      );

      // SRE: Enhance visibility into persistence failures for debugging
      if (errorMsg.includes("column") || errorMsg.includes("relation")) {
        this.logger.error(
          `[DB_SCHEMA_MISMATCH] Potential schema drift detected during trade save: ${errorMsg}`,
        );
      }

      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async saveTrade(trade: any) {
    // Legacy method, keeping for compatibility if needed, but routing to atomic
    const status = await this.getStatus();
    await this.saveTradeAtomic(trade, status.balance);
  }

  private validateConfig(config: SessionConfig) {
    if (!config) throw new BadRequestException("Configuration is required");

    // 1. Scan Mode Dependencies
    if (config.scan_mode === "active_window") {
      if (!config.scan_window_duration_sec)
        throw new BadRequestException(
          "Window duration is required for Active Window mode",
        );
      if (!config.scan_check_interval_sec)
        throw new BadRequestException(
          "Check interval is required for Active Window mode",
        );
    }

    // 2. Stop Loss Dependencies
    if (config.sl_type === "lookback_low/high") {
      if (!config.sl_lookback_period || config.sl_lookback_period < 1) {
        throw new BadRequestException(
          "Valid lookback period is required for Lookback SL type",
        );
      }
    }

    // 3. Take Profit Dependencies
    if (config.tp_mode === "exp_rr_seq") {
      if (!config.live_rr_sequence || config.live_rr_sequence.length === 0) {
        throw new BadRequestException(
          "Live RR sequence is required for Exponential RR mode",
        );
      }
      if (
        !config.exit_rr_sequence ||
        config.exit_rr_sequence.length !== config.live_rr_sequence.length
      ) {
        throw new BadRequestException(
          "Exit RR sequence must match Live RR sequence length",
        );
      }
    }

    // 4. Signal Parameter Dependencies
    const signalParams = config.signal_params || {};

    const allEnabled = [
      ...(config.enabled_signals || []),
      ...(config.exit_signals || []),
    ];

    if (allEnabled.includes("ema_dual_cross")) {
      const fast = parseInt(
        signalParams.entry_ema_fast || signalParams.exit_ema_fast || "0",
        10,
      );
      const slow = parseInt(
        signalParams.entry_ema_slow || signalParams.exit_ema_slow || "0",
        10,
      );
      if (fast <= 0 || slow <= 0)
        throw new BadRequestException(
          "EMA Dual Cross requires both fast and slow periods (e.g., 9 and 21)",
        );
      if (fast >= slow)
        throw new BadRequestException(
          "EMA Dual Cross: Fast period must be less than slow period",
        );
    }

    if (allEnabled.includes("ma") && !signalParams.ma_period) {
      throw new BadRequestException(
        "MA Cross signal requires ma_period in signal_params",
      );
    }

    if (
      (allEnabled.includes("ema") || allEnabled.includes("ema_close")) &&
      !signalParams.ema_period &&
      !signalParams.entry_ema_period &&
      !signalParams.exit_ema_period
    ) {
      throw new BadRequestException(
        "EMA signals require an EMA period to be defined",
      );
    }

    // DATA-02: Indicator Convergence validation
    const maxCandles = parseInt(process.env.KLINE_MAX_CANDLES || "200", 10);
    const indicatorPeriods = [
      signalParams.ema_period,
      signalParams.entry_ema_period,
      signalParams.exit_ema_period,
      signalParams.entry_ema_slow,
      signalParams.exit_ema_slow,
      signalParams.ma_period,
    ]
      .map((p) => parseInt(p, 10))
      .filter((p) => !isNaN(p));

    for (const p of indicatorPeriods) {
      if (p >= maxCandles * 0.5) {
        throw new BadRequestException(
          `Indicator period ${p} is too large for current KLINE_MAX_CANDLES (${maxCandles}). Values may not converge for reliable signals. Use a period < ${Math.floor(maxCandles * 0.5)} or increase KLINE_MAX_CANDLES.`,
        );
      }
    }

    if (allEnabled.includes("supertrend")) {
      const stPeriodVal = signalParams.supertrend_period;
      const stPeriod = parseInt(
        stPeriodVal !== undefined && stPeriodVal !== null && stPeriodVal !== ''
          ? String(stPeriodVal)
          : "10",
        10
      );
      if (!isNaN(stPeriod)) {
        if (stPeriod * 5 >= maxCandles) {
          throw new BadRequestException(
            `Supertrend ATR period ${stPeriod} is too large for current KLINE_MAX_CANDLES (${maxCandles}). The required warmup (${stPeriod * 5} candles) exceeds or equals KLINE_MAX_CANDLES. Please use an ATR Period < ${Math.floor(maxCandles / 5)} or increase KLINE_MAX_CANDLES.`,
          );
        }
      }
    }

    // 5. Risk Constraints
    const riskPerTrade = config.risk_pct_per_trade ?? 0;
    const maxTotalRisk = config.max_total_risk_pct ?? 100;
    if (riskPerTrade > maxTotalRisk) {
      throw new BadRequestException(
        "Risk per trade cannot exceed maximum total risk",
      );
    }

    if (
      config.slippage_abort_threshold != null &&
      config.slippage_abort_threshold > CONFIG_LIMITS.SLIPPAGE_ABORT_MAX
    ) {
      throw new BadRequestException(
        `Slippage abort threshold cannot exceed ${CONFIG_LIMITS.SLIPPAGE_ABORT_MAX * 100}%`,
      );
    }

    // SENTINEL: Validate Record properties to prevent Stored XSS, injection, or DoS
    const validateRecord = (
      name: string,
      record: any,
      maxKeys: number,
      valueValidator: (val: any) => boolean,
      valError: string
    ) => {
      if (!record || typeof record !== "object" || Array.isArray(record)) return;
      const keys = Object.keys(record);
      if (keys.length > maxKeys) {
        throw new BadRequestException(`${name} cannot exceed ${maxKeys} entries`);
      }
      for (const k of keys) {
        if (k.length > 50 || !/^[a-zA-Z0-9_\-]*$/.test(k) || /<[a-zA-Z!/]/.test(k)) {
          throw new BadRequestException(`Invalid key format in ${name}`);
        }
        if (!valueValidator(record[k])) {
          throw new BadRequestException(`${valError} for key "${k}"`);
        }
      }
    };

    validateRecord(
      "exit_signal_delays",
      config.exit_signal_delays,
      50,
      (v) => typeof v === "number" && !isNaN(v) && v >= 0 && v <= 86400,
      "exit_signal_delays values must be numbers between 0 and 86400"
    );

    validateRecord(
      "exit_signal_actions",
      config.exit_signal_actions,
      50,
      (v) => v === "close" || v === "lock_sl",
      "exit_signal_actions values must be 'close' or 'lock_sl'"
    );

    validateRecord(
      "signal_timeframes",
      config.signal_timeframes,
      50,
      (v) => typeof v === "string" && v.length <= 10 && /^(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M|default)$/.test(v),
      "signal_timeframes values must be valid Binance kline intervals"
    );

    validateRecord(
      "scanner_weights",
      config.scanner_weights,
      10,
      (v) => typeof v === "number" && !isNaN(v) && v >= 0 && v <= 100,
      "scanner_weights values must be numbers between 0 and 100"
    );

    if (config.signal_params && typeof config.signal_params === "object" && !Array.isArray(config.signal_params)) {
      const keys = Object.keys(config.signal_params);
      if (keys.length > 50) {
        throw new BadRequestException("signal_params cannot exceed 50 entries");
      }
      const valPrimitive = (v: any): boolean => {
        if (v === null || v === undefined) return true;
        const t = typeof v;
        if (t === "boolean" || t === "number") return !isNaN(v);
        if (t === "string") return v.length <= 100 && !/<[a-zA-Z!/]/.test(v);
        return false;
      };
      for (const k of keys) {
        if (k.length > 50 || !/^[a-zA-Z0-9_\-]*$/.test(k) || /<[a-zA-Z!/]/.test(k)) {
          throw new BadRequestException("Invalid key format in signal_params");
        }
        const v = config.signal_params[k];
        if (Array.isArray(v)) {
          if (v.length > 50) throw new BadRequestException(`Array values in signal_params for key "${k}" cannot exceed 50 items`);
          for (const item of v) {
            if (!valPrimitive(item)) throw new BadRequestException(`Invalid value in signal_params array for key "${k}"`);
          }
        } else if (v && typeof v === "object") {
          throw new BadRequestException(`Nested objects in signal_params are not allowed for key "${k}"`);
        } else {
          if (!valPrimitive(v)) throw new BadRequestException(`Invalid value in signal_params for key "${k}"`);
        }
      }
    }
  }

  async startSession(
    config: SessionConfig,
    paperMode: boolean,
    sessionId?: string,
    ip?: string,
    userAgent?: string,
  ) {
    let mode = config.trading_mode || (paperMode ? "paper" : "live");
    if (mode !== "paper" && !process.env.ENCRYPTION_KEY) {
      throw new ConfigValidationException(
        "ENCRYPTION_KEY must be set to start a session in live or testnet mode.",
      );
    }

    if (this.sessionRunning) {
      throw new ConflictException("Session already running");
    }

    // Force mode consistency: testnet/live must have paper_mode disabled
    if (mode === "testnet" || mode === "live") {
      config.paper_mode = false;
      paperMode = false;
    } else {
      config.paper_mode = true;
      paperMode = true;
    }

    // Deep validation of dependent fields
    this.validateConfig(config);

    let session;
    if (sessionId) {
      session = await this.sessionRepository.findOne({
        where: { id: sessionId },
      });
      if (!session) throw new NotFoundException("Session not found");

      // CODE-03: Validate config on restart
      this.validateConfig(session.config);

      // Update session to running
      session.running = true;
      await this.sessionRepository.save(session);

      // Use existing config and balance
      config = session.config;
      paperMode = session.paperMode;
      mode = session.tradingMode || (paperMode ? "paper" : "live");

      // Preserving starting balance if it exists in the config to maintain correct PnL calculation across restarts
      if (mode === "paper") {
        config.paper_starting_balance =
          config.paper_starting_balance ||
          roundEight(Number(session.balance) - Number(session.totalPnl));
      } else if (mode === "testnet") {
        (config as any).testnet_starting_balance =
          (config as any).testnet_starting_balance ||
          roundEight(Number(session.balance) - Number(session.totalPnl));
      } else {
        config.live_starting_balance =
          config.live_starting_balance ||
          roundEight(Number(session.balance) - Number(session.totalPnl));
      }
    } else {
      // Ensure starting balance is explicitly in the config for new sessions
      if (mode === "paper") {
        // Inherit from settings if not explicitly provided
        if (
          config.paper_starting_balance === undefined ||
          config.paper_starting_balance === null
        ) {
          const settings = await this.settingsRepository.findOne({
            where: { id: "default" },
          });
          config.paper_starting_balance = settings
            ? Number(settings.paper_balance)
            : 10000.0;
        }
      } else if (mode === "testnet") {
        if (
          config.testnet_starting_balance === undefined ||
          config.testnet_starting_balance === null
        ) {
          const settings = await this.settingsRepository.findOne({
            where: { id: "default" },
          });
          // Note: If Binance fetch is used later, this acts as a fallback for the risk engine
          config.testnet_starting_balance = settings
            ? Number(settings.testnet_balance)
            : 0;
        }
      } else {
        if (
          config.live_starting_balance === undefined ||
          config.live_starting_balance === null
        ) {
          const settings = await this.settingsRepository.findOne({
            where: { id: "default" },
          });
          config.live_starting_balance = settings
            ? Number(settings.live_balance)
            : 0;
        }
      }

      session = this.sessionRepository.create({
        running: true,
        paperMode,
        tradingMode: config.trading_mode || (paperMode ? "paper" : "live"),
        balance:
          mode === "paper"
            ? config.paper_starting_balance
            : mode === "testnet"
              ? (config as any).testnet_starting_balance
              : config.live_starting_balance,
        strategyLabel: config.strategy_label || "Momentum Strategy",
        config,
      });
      session = await this.sessionRepository.save(session);
    }

    this.currentSessionId = session.id;
    this.sessionRunning = true;

    // Load potentially orphaned open trades for reconciliation
    // For the active session, we'll resume these trades in the engine
    let openTrades: TradeEntity[] = [];
    try {
      openTrades = await this.tradeRepository.find({
        where: { status: "OPEN" as any },
      });
    } catch (e: any) {
      this.logger.error(
        `Failed to fetch open trades for reconciliation: ${e.message}`,
      );
      // Check if it's a schema issue and provide more context
      if (e.message.includes("column") || e.message.includes("relation")) {
        this.logger.error(
          "CRITICAL: Database schema mismatch detected. Ensure all migrations have run successfully.",
        );
      }
      throw e; // Still throw because we can't safely proceed without knowing open trades
    }

    // Instantiate Binance client if not in paper mode
    let binanceClient = null;
    if (mode !== "paper") {
      const settings = await this.settingsRepository.findOne({
        where: { id: "default" },
        select: [
          "id",
          "binance_api_key",
          "binance_api_secret",
          "binance_testnet_api_key",
          "binance_testnet_api_secret",
        ],
      });
      if (!settings)
        throw new NotFoundException(
          "Settings not found. Please configure API keys first.",
        );

      const isTestnet = mode === "testnet";
      const key = isTestnet
        ? settings.binance_testnet_api_key
        : settings.binance_api_key;
      const secret = isTestnet
        ? settings.binance_testnet_api_secret
        : settings.binance_api_secret;

      if (!key || !secret) {
        throw new BadRequestException(
          `Binance ${isTestnet ? "Testnet" : "Live"} API keys are not configured.`,
        );
      }

      const decryptedKey = decrypt(key);
      const decryptedSecret = decrypt(secret);

      if (!decryptedKey || !decryptedSecret) {
        throw new BadRequestException(
          `Binance ${isTestnet ? "Testnet" : "Live"} API keys cannot be successfully decrypted. Please check or re-configure them in Settings.`,
        );
      }

      binanceClient = this.binanceClientFactory.createClient(
        decryptedKey,
        decryptedSecret,
        isTestnet,
      );
    }

    // CHRONOS: Start User Data Stream buffering BEFORE any REST snapshot reconciliation
    // to eliminate the blind spot where exchange activity during startup is missed.
    if (binanceClient && mode !== "paper") {
      await this.tradingSessionService.startUds(binanceClient);
      this.tradingSessionService.startBuffering();
    }

    // DATA-07: Ensure exchange filters are loaded BEFORE reconciliation to avoid "Symbol not found" errors
    try {
      const isTestnet = mode === "testnet";
      const restBase = isTestnet
        ? "https://testnet.binancefuture.com"
        : ENGINE_CONSTANTS.BINANCE_REST_BASE;
      await this.marketFeed.fetchExchangeInfo(restBase);
    } catch (e) {
      this.logger.error(
        `Failed to pre-load exchange info: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // 1. Reconciliation Prep: Identification of potential orphans.
    // SRE: Deferring final closure of orphans until exchange state is verified.
    let potentialOrphans: TradeEntity[] = [];
    let recalculationNeeded = false;

    for (const trade of openTrades) {
      let isOrphaned = false;
      let orphanReason = "";

      if (trade.sessionId) {
        const tSession = await this.sessionRepository.findOne({
          where: { id: trade.sessionId },
        });
        if (!tSession) {
          isOrphaned = true;
          orphanReason = `Session ${trade.sessionId} not found`;
        } else if (!tSession.running && tSession.id !== this.currentSessionId) {
          isOrphaned = true;
          orphanReason = `Session ${trade.sessionId} is no longer running`;
        }
      } else {
        const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
        const entryTime = trade.entry_ts
          ? new Date(trade.entry_ts).getTime()
          : 0;
        if (Date.now() - entryTime > STALE_THRESHOLD_MS) {
          isOrphaned = true;
          orphanReason = `Trade exceeded stale threshold (Entry: ${trade.entry_ts})`;
        }
      }

      if (isOrphaned) {
        (trade as any).orphanReason = orphanReason;
        potentialOrphans.push(trade);
        continue;
      }

      // Offline Breach Detection for paper trades in the current session
      // SRE: Re-verify that the trade still belongs to this session and hasn't been reconciled out
      if (
        mode === "paper" &&
        trade.sessionId === this.currentSessionId &&
        !(trade as any).reconciled_out
      ) {
        const currentPrice = await this.tradingSessionService.fetchTickerPrice(
          trade.symbol,
        );
        if (currentPrice) {
          const side = trade.direction.toUpperCase();
          const sl = Number(trade.current_sl || 0);
          const tp = Number(trade.tp || 0);

          let breached = false;
          let reason = EXIT_REASONS.AUTO_RECONCILED_EXIT;

          if (side === "LONG") {
            if (sl > 0 && currentPrice <= sl) {
              breached = true;
              reason = EXIT_REASONS.AUTO_RECONCILED_SL;
            } else if (tp > 0 && currentPrice >= tp) {
              breached = true;
              reason = EXIT_REASONS.AUTO_RECONCILED_TP;
            }
          } else {
            if (sl > 0 && currentPrice >= sl) {
              breached = true;
              reason = EXIT_REASONS.AUTO_RECONCILED_SL;
            } else if (tp > 0 && currentPrice <= tp) {
              breached = true;
              reason = EXIT_REASONS.AUTO_RECONCILED_TP;
            }
          }

          if (breached) {
            this.logger.warn(
              `Resumed trade ${trade.symbol} breached SL/TP during downtime. Auto-closing at ${currentPrice}.`,
            );
            await this.logMessage(
              `Resumed trade ${trade.symbol} breached SL/TP during downtime. Auto-closed at ${currentPrice} (${reason}).`,
              "warn",
            );
            const pnl = roundEight(
              side === "LONG"
                ? (currentPrice - Number(trade.entry_price)) * Number(trade.qty)
                : (Number(trade.entry_price) - currentPrice) *
                    Number(trade.qty),
            );

            // Map reason to specific terminal status
            let terminalStatus: any = "CLOSED";
            if (reason === EXIT_REASONS.AUTO_RECONCILED_SL)
              terminalStatus = "CLOSED_SL";
            else if (reason === EXIT_REASONS.AUTO_RECONCILED_TP)
              terminalStatus = "CLOSED_TP";

            const updatedTrade = {
              ...trade,
              status: terminalStatus,
              exit_ts: new Date(),
              exit_price: currentPrice,
              pnl,
              exit_reason: reason,
              is_reconciliation: true,
            };

            // SRE: Accumulate PnL directly on the session instance during the loop
            // to ensure multiple breaches are correctly reflected in the final balance.
            session.balance = roundEight(Number(session.balance) + pnl);

            await this.saveTradeAtomic(updatedTrade, Number(session.balance));
            (trade as any).reconciled_out = true;
            recalculationNeeded = true;
          }
        }
      }
    }

    const sessionOpenTrades = openTrades.filter(
      (t) =>
        t.sessionId === this.currentSessionId && !(t as any).reconciled_out,
    );

    // Fetch current global balance to ensure risk engine uses real-time account state
    const currentSettings = await this.settingsRepository.findOne({
      where: { id: "default" },
    });
    const currentGlobalBalance = currentSettings
      ? mode === "paper"
        ? Number(currentSettings.paper_balance)
        : mode === "testnet"
          ? Number(currentSettings.testnet_balance)
          : Number(currentSettings.live_balance)
      : mode === "paper"
        ? config.paper_starting_balance || 10000
        : mode === "testnet"
          ? (config as any).testnet_starting_balance
          : config.live_starting_balance;

    this.logger.log(
      `[Lifecycle] Starting session ${this.currentSessionId} in ${mode} mode. Detected starting balance: ${currentGlobalBalance}`,
    );

    // Update global log levels based on session config
    updateLogLevels(!!config.debug_mode);

    // BOLT: Set binance client before reconciliation so fetchPosition works
    this.tradingSessionService.setBinanceClient(
      binanceClient,
      mode === "paper",
    );

    // 2. Reconciliation: Verify and Process Potential Orphans and Active Trades
    // Reconcile open trades with actual exchange positions
    if (mode !== "paper" && binanceClient) {
      try {
        // PERF: Optimization - If we have a very small number of session trades, fetch them individually to save weight.
        // positionInformationV3 (all) = 5 weight, but fetches ALL symbols.
        // positionInformationV3 (symbol) = 5 weight, but only returns 1.
        // currentAllOpenOrders (all) = 40 weight.
        // currentAllOpenOrders (symbol) = 1 weight.

        const tradesToVerify = [...sessionOpenTrades, ...potentialOrphans];
        const uniqueSymbols = Array.from(
          new Set(tradesToVerify.map((t) => t.symbol)),
        );

        // Smart Tiered Audit: For sessions with <= 5 trades, use targeted per-symbol audits (Weight 5+1).
        // For larger sets, revert to bulk audits (Weight 5+40).
        const useBulkAudit = uniqueSymbols.length > 5;
        this.logger.log(
          `[Reconciliation] Starting audit for ${uniqueSymbols.length} symbols. Mode: ${useBulkAudit ? "BULK" : "TARGETED"}`,
        );

        let activeExPositions: any[] = [];
        let allOpenOrders: any[] = [];

        if (useBulkAudit) {
          const allExchangePositions =
            await this.tradingSessionService.fetchAllPositions();
          activeExPositions = allExchangePositions.filter(
            (p) => Math.abs(parseFloat(p.positionAmt)) > 0,
          );
          allOpenOrders = await this.orderManager.fetchAllOpenOrders();
        } else {
          // Targeted Audit: Fetch only what we need to save weight in Window 1
          // BOLT: Added small delay between symbol audits to avoid IP-ban burst penalties on boot
          for (const symbol of uniqueSymbols) {
            const pos = await this.orderManager.fetchPosition(symbol, {
              forceFresh: true,
            });
            if (pos && Math.abs(parseFloat(pos.positionAmt)) > 0)
              activeExPositions.push(pos);
            const orders = await this.orderManager.fetchOpenOrders(symbol);
            allOpenOrders.push(...orders);
            if (uniqueSymbols.length > 1) {
              await new Promise((resolve) => setTimeout(resolve, 300));
            }
          }
        }
        const ordersBySymbol = new Map<string, any[]>();
        for (const o of allOpenOrders) {
          const list = ordersBySymbol.get(o.symbol) || [];
          list.push(o);
          ordersBySymbol.set(o.symbol, list);
        }

        // PERF: Use Map for O(1) lookup during cross-reconciliation
        const activeExMap = new Map(
          activeExPositions.map((p) => [p.symbol, p]),
        );

        // WebSocket-First Baseline: Seed the real-time position cache with established exchange state
        for (const p of activeExPositions) {
          this.tradingSessionService.seedRealTimePosition(
            p.symbol,
            parseFloat(p.positionAmt),
            parseFloat(p.entryPrice),
          );
        }

        // 1. Verify and Process Potential Orphans
        for (const trade of potentialOrphans) {
          const position = activeExMap.get(trade.symbol);
          const posAmt = position ? parseFloat(position.positionAmt) : 0;
          const hasPosition = Math.abs(posAmt) > 0;

          if (hasPosition) {
            const msg = `[Reconciliation] Potential orphan ${trade.symbol} (${trade.id}) is STILL ACTIVE on exchange (Amt: ${posAmt}). Resuming instead of closing. Reason: ${(trade as any).orphanReason}`;
            this.logger.warn(msg);
            await this.logMessage(msg, "warn");

            // BOLT: Rehydrate strategy config for resumed orphans to ensure they keep updating
            // with the current session's settings.
            trade.strategy_config = {
              ...config,
              ...(trade.strategy_config || {}),
              strategy_label:
                trade.strategy_label ||
                config.strategy_label ||
                "Momentum Strategy",
            };

            // Move to sessionOpenTrades so it gets resumed
            sessionOpenTrades.push(trade);
          } else {
            const msg = `[Reconciliation] Verified: Orphan ${trade.symbol} (${trade.id}) is flat on exchange. Marking closed. Reason: ${(trade as any).orphanReason}`;
            this.logger.log(msg);
            const tickerPrice = this.orderManager.tickerCache?.getPrice(trade.symbol) || Number(trade.current_sl || trade.entry_price || 0);
            const context = await this.orderManager.recoverClosingContext(trade.symbol, trade as any, tickerPrice);
            const updates = await this.finalizeOrphanedTrade(trade, mode, context.price, context.reason);
            await this.tradeRepository.update(trade.id, updates);
            recalculationNeeded = true;
          }
        }

        // 2. Reconcile Active Session Trades
        for (const trade of sessionOpenTrades) {
          try {
            // SRE: Critical Check - Does the position actually exist on exchange?
            const position = activeExMap.get(trade.symbol);
            const posAmt = position ? parseFloat(position.positionAmt) : 0;
            const hasPosition = Math.abs(posAmt) > 0;

            if (!hasPosition) {
              this.logger.warn(
                `[Reconciliation] Local trade ${trade.symbol} has no corresponding exchange position. Marking as closed.`,
              );
              await this.logMessage(
                `Live position for ${trade.symbol} was not found on exchange during reconciliation. Marking as orphaned.`,
                "warn",
              );
              const tickerPrice = this.orderManager.tickerCache?.getPrice(trade.symbol) || Number(trade.current_sl || trade.entry_price || 0);
              const context = await this.orderManager.recoverClosingContext(trade.symbol, trade as any, tickerPrice);
              const updates = await this.finalizeOrphanedTrade(trade, mode, context.price, context.reason);
              await this.tradeRepository.update(trade.id, updates);
              (trade as any).reconciled_out = true;
              recalculationNeeded = true;
              continue;
            }

            // SRE: Secondary Check - Is there any order (Entry or SL) active for this trade?
            const symbolOrders = ordersBySymbol.get(trade.symbol) || [];
            const hasOrder = symbolOrders.some(
              (o) =>
                (o as any).orderId == trade.binance_order_id ||
                (o as any).orderId == trade.binance_stop_order_id ||
                (o as any).clientOrderId === `sl-${trade.id.substring(0, 8)}`,
            );

            if (!hasOrder) {
              this.logger.warn(
                `[Reconciliation] Trade ${trade.symbol} exists on exchange but has NO protection SL orders. Adoption will proceed, Watchdog will re-arm.`,
              );
            }

            // Sync local trade state with actual exchange position to ensure entry price and qty accuracy
            const exEntryPrice = parseFloat(position!.entryPrice);

            if (
              exEntryPrice > 0 &&
              Math.abs(exEntryPrice - Number(trade.entry_price)) >
                exEntryPrice * 0.0001
            ) {
              this.logger.log(
                `Syncing entry price for ${trade.symbol}: ${trade.entry_price} -> ${exEntryPrice}`,
              );
              trade.entry_price = exEntryPrice;
            }

            if (Math.abs(posAmt) !== Math.abs(Number(trade.qty))) {
              this.logger.log(
                `Syncing quantity for ${trade.symbol}: ${trade.qty} -> ${Math.abs(posAmt)}`,
              );
              trade.qty = Math.abs(posAmt);
            }
            // Update direction if mismatch (rare but safe)
            const exDir = posAmt > 0 ? "LONG" : "SHORT";
            if (trade.direction !== exDir) {
              this.logger.warn(
                `Syncing direction for ${trade.symbol}: ${trade.direction} -> ${exDir}`,
              );
              trade.direction = exDir;
            }
          } catch (innerErr) {
            this.logger.error(
              `Failed to reconcile ${trade.symbol}: ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`,
            );
          }
        }

        // INVERSE RECONCILIATION: Check for exchange positions with NO local record
        const localSymbols = new Set(
          sessionOpenTrades
            .filter((t) => !(t as any).reconciled_out)
            .map((t) => t.symbol),
        );
        const ghostPositions = activeExPositions.filter(
          (p) => !localSymbols.has(p.symbol),
        );

        if (ghostPositions.length > 0) {
          const imported = await this.adoptExchangePositions(
            ghostPositions,
            mode,
            config,
            allOpenOrders,
          );
          if (imported.length > 0) {
            sessionOpenTrades.push(...imported);
            recalculationNeeded = true;
          }
        }
      } catch (e) {
        this.logger.warn(
          `Failed to fetch all positions for bulk reconciliation: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    const filteredOpenTrades = sessionOpenTrades.filter(
      (t) => !(t as any).reconciled_out,
    );

    // Load initial history for TOD and period-based risk context
    // DATA-07: Load history for the current mode across all sessions to ensure risk limits are enforced after restart
    // BOLT: History must be loaded AFTER reconciliation to include newly closed orphans.
    const rawHistory = await this.tradeRepository.find({
      where: { status: In(TERMINAL_STATUSES as any) },
      order: { exit_ts: "DESC" },
      take: 500,
    });

    const initialHistory = rawHistory
      .filter((t) => {
        const tConfig = t.strategy_config || {};
        const tMode =
          tConfig.trading_mode ||
          (tConfig.paper_mode === false ? "live" : "paper");
        return tMode === mode;
      })
      .slice(0, 200);

    // Paper mode orphan handling (Simplified verification as there is no exchange)
    if (mode === "paper") {
      for (const trade of potentialOrphans) {
        this.logger.warn(
          `[Reconciliation] Trade ${trade.symbol} (${trade.id}) is orphaned. Reason: ${(trade as any).orphanReason}. Marking as closed.`,
        );
        const updates = await this.finalizeOrphanedTrade(trade, mode);
        await this.tradeRepository.update(trade.id, updates);
        await this.logMessage(
          `Trade ${trade.symbol} was orphaned (${(trade as any).orphanReason}) and marked closed.`,
          "warn",
        );
        recalculationNeeded = true;
      }
    }

    if (recalculationNeeded) {
      this.logger.log(
        `[Lifecycle] Triggering PnL recalculation after reconciliation for session ${this.currentSessionId}`,
      );
      const aggregation = await this.tradeRepository
        .createQueryBuilder("trade")
        .select("SUM(trade.pnl)", "sum")
        .where("trade.sessionId = :sessionId", {
          sessionId: this.currentSessionId,
        })
        .andWhere("trade.status IN (:...statuses)", {
          statuses: [...TERMINAL_STATUSES, "OPEN"],
        })
        .getRawOne();
      const realizedPnl = roundEight(Number(aggregation?.sum || 0));
      await this.sessionRepository.update(this.currentSessionId!, {
        totalPnl: realizedPnl,
      });
    }

    // Start the actual trading engine
    await this.tradingSessionService.start(
      config,
      binanceClient,
      this.currentSessionId,
      initialHistory as any,
      currentGlobalBalance,
      filteredOpenTrades as any,
    );

    // CHRONOS: Replay buffered events AFTER engine is fully initialized
    // to ensure any activity during the REST snapshot phase is incorporated.
    if (mode !== "paper") {
      await this.tradingSessionService.replayBuffer();
    }

    this.logger.log(
      `Session ${this.currentSessionId} ${sessionId ? "restarted" : "started"} in ${mode} mode`,
    );
    await this.logMessage(
      `Session started in ${mode} mode with ${currentGlobalBalance} starting balance.`,
      "info",
    );

    await this.auditLog.log({
      action: sessionId ? "RESTART_SESSION" : "START_SESSION",
      resourceId: this.currentSessionId || undefined,
      actor: ip,
      ip,
      userAgent,
      details: { mode, paperMode },
    });

    return { strategyId: this.currentSessionId, status: "started" };
  }

  @OnEvent("reconciliation.adopt_positions")
  async handleAdoptPositions(payload: { positions: any[]; orders: any[] }) {
    if (!this.sessionRunning || !this.currentSessionId) return;

    const session = await this.sessionRepository.findOne({
      where: { id: this.currentSessionId },
      select: ["id", "tradingMode", "paperMode", "config"],
    });

    if (!session) return;
    const mode = session.tradingMode || (session.paperMode ? "paper" : "live");

    const positionsToAdopt = (payload.positions || []).filter(
      (p) => p && p.symbol && !this.adoptingSymbols.has(p.symbol)
    );

    if (positionsToAdopt.length === 0) {
      this.logger.debug(
        `[Reconciliation] All positions in adoption request are already being adopted. Skipping.`
      );
      return;
    }

    for (const p of positionsToAdopt) {
      this.adoptingSymbols.add(p.symbol);
    }

    this.logger.warn(
      `[Reconciliation] Processing adoption request for ${positionsToAdopt.length} positions.`,
    );

    try {
      const imported = await this.adoptExchangePositions(
        positionsToAdopt,
        mode,
        session.config,
        payload.orders,
      );

      // Hot-add adopted trades to the running engine
      for (const t of imported) {
        const tradeModel = plainToInstance(Trade, t);
        // BOLT: Use addTrade to ensure PositionTracker correctly initializes milestone state
        this.tradingSessionService.addTrade(tradeModel as any);

        this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, {
          trade: tradeModel,
        });
      }

      if (imported.length > 0) {
        // BOLT: Synchronize active trades state and trigger watchlist update for newly adopted trades
        this.tradingSessionService.seedActiveTrades(
          this.tradingSessionService.getActiveTradesRaw(),
        );
        this.eventEmitter.emit(ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE);
        this.eventEmitter.emit(ENGINE_EVENTS.RISK_GATES_UPDATED);
      }
    } finally {
      for (const p of positionsToAdopt) {
        this.adoptingSymbols.delete(p.symbol);
      }
    }
  }

  private async finalizeOrphanedTrade(
    trade: TradeEntity,
    mode: "live" | "paper" | "testnet",
    contextPrice?: number,
    contextReason?: string
  ): Promise<Partial<TradeEntity>> {
    const isPaper = mode === "paper";
    const tickerPrice = this.orderManager.tickerCache?.getPrice(trade.symbol) || Number(trade.current_sl || trade.entry_price || 0);
    const exitPriceToUse = contextPrice || tickerPrice || Number(trade.current_sl || trade.entry_price || 0);

    let finalPnl = Number(trade.pnl || 0);
    let finalPnlPct = Number(trade.pnl_pct || 0);
    let initialQty = Number(trade.qty || 1);
    let realizedFee = Number(trade.realized_fee || 0);

    if (!isPaper) {
      const riskDist = Math.abs(Number(trade.entry_price) - Number(trade.initial_sl));
      initialQty = (riskDist > 0 && trade.initial_risk_usdt) ? (trade.initial_risk_usdt / riskDist) : (Number(trade.qty) || 1);

      const totalPnlPoints = trade.direction === 'LONG'
        ? exitPriceToUse - Number(trade.entry_price)
        : Number(trade.entry_price) - exitPriceToUse;

      const totalGrossPnl = totalPnlPoints * initialQty;
      finalPnl = roundEight(totalGrossPnl - realizedFee - (Number(trade.funding_fee) || 0));

      const notional = Number(trade.entry_price) * initialQty;
      const computedPnlPct = (notional !== 0) ? (finalPnl / notional) * 100 : 0;
      finalPnlPct = roundEight(Number.isFinite(computedPnlPct) ? computedPnlPct : 0);
    } else {
      // Paper mode
      const exitFee = roundEight(exitPriceToUse * Number(trade.qty) * ENGINE_CONSTANTS.SIMULATED_FEE_RATE);
      realizedFee = roundEight((Number(trade.realized_fee) || 0) + exitFee);

      const finalPnlPoints = trade.direction === 'LONG'
        ? exitPriceToUse - Number(trade.entry_price)
        : Number(trade.entry_price) - exitPriceToUse;

      const finalGrossPnl = finalPnlPoints * (Number(trade.qty) || 0);
      finalPnl = roundEight(finalGrossPnl - realizedFee - (Number(trade.funding_fee) || 0));

      const notional = Number(trade.entry_price) * (Number(trade.qty) || 0);
      const computedPnlPct = (notional !== 0) ? (finalPnl / notional) * 100 : 0;
      finalPnlPct = roundEight(Number.isFinite(computedPnlPct) ? computedPnlPct : 0);
    }

    return {
      status: "CLOSED_ORPHANED",
      exit_price: exitPriceToUse,
      exit_ts: new Date(),
      is_reconciliation: true,
      pnl: finalPnl,
      pnl_pct: finalPnlPct,
      qty: initialQty,
      realized_fee: realizedFee,
      exit_reason: contextReason || trade.exit_reason || "CLOSED_ORPHANED",
    };
  }

  /**
   * SRE: Adopts exchange positions by creating local synthetic trade records.
   * Ensures that "ghost" trades are brought under system protection and UI visibility.
   */
  private async adoptExchangePositions(
    ghostPositions: any[],
    mode: string,
    config: SessionConfig | null,
    preFetchedOrders?: any[],
  ): Promise<TradeEntity[]> {
    const imported: TradeEntity[] = [];
    if (ghostPositions.length === 0) return imported;

    // PERF: Smart Audit for ghost positions.
    // If few ghosts, fetch orders individually (Weight 1 per sym).
    // If many, fetch bulk (Weight 40).
    let allOrdersMap = new Map<string, any[]>();
    const useBulkAudit = ghostPositions.length > 5 && !preFetchedOrders;

    try {
      if (preFetchedOrders) {
        for (const o of preFetchedOrders) {
          const list = allOrdersMap.get(o.symbol) || [];
          list.push(o);
          allOrdersMap.set(o.symbol, list);
        }
      } else if (useBulkAudit) {
        this.logger.log(
          `[Reconciliation] Performing fresh bulk open order audit for ${ghostPositions.length} ghost positions...`,
        );
        const allExOrders = await this.orderManager.fetchAllOpenOrders();
        for (const o of allExOrders) {
          const list = allOrdersMap.get(o.symbol) || [];
          list.push(o);
          allOrdersMap.set(o.symbol, list);
        }
      }
      // If not bulk and not prefetched, we fetch per symbol in the loop below
    } catch (e) {
      this.logger.warn(
        `[Reconciliation] Failed to prepare orders for adoption: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    for (const exPos of ghostPositions) {
      try {
        const amt = parseFloat(exPos.positionAmt);
        const entryPrice = parseFloat(exPos.entryPrice);
        const direction = amt > 0 ? "LONG" : "SHORT";
        const qty = Math.abs(amt);
        const positionSide = exPos.positionSide || "BOTH";

        // SRE: Dust Threshold Guard. Ignore ghost positions with negligible notional value (e.g. < 0.10 USDT)
        // to avoid unnecessary alarms and "Nuclear Options" for residual precision dust.
        const notional = qty * entryPrice;
        if (notional < 0.1) {
          this.logger.debug(
            `[Reconciliation] Skipping adoption for ${exPos.symbol}: negligible notional value (${notional.toFixed(4)} USDT)`,
          );
          continue;
        }

        // SRE: Resilience against Hedge Mode leftovers.
        // We only support One-Way mode (BOTH).
        if (positionSide !== "BOTH") {
          this.logger.warn(
            `[Reconciliation] Skipping adoption for ${exPos.symbol}: Position side is ${positionSide} (Expected BOTH). Engine only supports One-Way mode.`,
          );
          continue;
        }

        // RESEARCH: Attempt to discover existing SL/TP protection on exchange for this position
        let slPrice = 0;
        let slId = undefined;
        let slType = undefined;
        let tpPrice = 0;

        try {
          // Targeted Audit for this ghost position if not already fetched
          let exOrders = allOrdersMap.get(exPos.symbol);
          if (!exOrders && !useBulkAudit && !preFetchedOrders) {
            this.logger.debug(
              `[Reconciliation] Fetching targeted orders for ghost ${exPos.symbol}`,
            );
            exOrders = await this.orderManager.fetchOpenOrders(exPos.symbol);
            allOrdersMap.set(exPos.symbol, exOrders);
          }
          exOrders = exOrders || [];

          // COMPLIANCE: Recognize more SL/TP order types during adoption
          const isSl = (o: any) => {
            const type = (o.type || o.algoType || "").toUpperCase();
            return type.includes("STOP");
          };
          const isTp = (o: any) => {
            const type = (o.type || o.algoType || "").toUpperCase();
            return type.includes("TAKE_PROFIT");
          };
          const isReduce = (o: any) =>
            o.reduceOnly === true ||
            o.reduceOnly === "true" ||
            o.closePosition === true ||
            o.closePosition === "true";

          const slOrder = exOrders.find((o) => isSl(o) && isReduce(o));
          const tpOrder = exOrders.find((o) => isTp(o) && isReduce(o));

          if (slOrder) {
            slPrice = parseFloat(
              slOrder.stopPrice || slOrder.triggerPrice || "0",
            );
            slId = String(slOrder.algoId || slOrder.orderId);
            slType = slOrder.algoId || slOrder.algoType ? "algo" : "standard";
            this.logger.log(
              `[Reconciliation] Found existing SL for ${exPos.symbol}: ${slId} @ ${slPrice}`,
            );
          }
          if (tpOrder) {
            tpPrice = parseFloat(
              tpOrder.stopPrice || tpOrder.triggerPrice || "0",
            );
            this.logger.log(
              `[Reconciliation] Found existing TP for ${exPos.symbol} @ ${tpPrice}`,
            );
          }

          if (!slOrder) {
            this.logger.debug(
              `[Reconciliation] No SL order found for ghost position ${exPos.symbol} in initial set. Performing exhaustive check...`,
            );

            // SRE: Exhaustive SL Discovery.
            // Standard fetchOpenOrders (via bulk or symbol) might miss algo orders if not explicitly polled.
            // We force a fresh algo-specific check to ensure no ghost SLs remain orphaned.
            try {
              const freshAlgoOrders =
                await this.orderManager.fetchOpenAlgoOrders(exPos.symbol, {
                  forceFresh: true,
                });
              const freshSlOrder = freshAlgoOrders.find(
                (o) => isSl(o) && isReduce(o),
              );

              if (freshSlOrder) {
                slPrice = parseFloat(
                  freshSlOrder.stopPrice || freshSlOrder.triggerPrice || "0",
                );
                slId = String(freshSlOrder.algoId || freshSlOrder.orderId);
                slType = "algo";
                this.logger.log(
                  `[Reconciliation] Found exhaustive ghost SL for ${exPos.symbol}: ${slId} @ ${slPrice}`,
                );
              }
            } catch (freshErr) {
              this.logger.debug(
                `[Reconciliation] Exhaustive algo check failed for ${exPos.symbol}: ${freshErr instanceof Error ? freshErr.message : String(freshErr)}`,
              );
            }
          }

          if (!slOrder && !slId) {
            this.logger.debug(
              `[Reconciliation] No SL order found for ghost position ${exPos.symbol}. Total orders checked for symbol: ${exOrders.length}`,
            );
          }
        } catch (orderErr) {
          this.logger.warn(
            `[Reconciliation] Failed to fetch existing orders for ${exPos.symbol}: ${orderErr instanceof Error ? orderErr.message : String(orderErr)}`,
          );
        }

        const msg = `CRITICAL: Found exchange-only position for ${exPos.symbol} (${direction} ${qty} @ ${entryPrice}). ${slId ? "Discovered existing SL at " + slPrice : "No SL found"}. Importing as synthetic trade. Mode: ${mode.toUpperCase()}`;
        this.logger.error(msg);
        await this.logMessage(msg, "error");

        // DATA-07: Restore full state of the trade including exit strategy baseline.
        // Use session's sl_distance_pct to estimate a more realistic initial_sl if none exists,
        // providing a better baseline for ratcheting RR calculations.
        const slDistPct = config?.sl_distance_pct || 2.0;
        const estimatedInitialSl =
          entryPrice *
          (direction === "LONG" ? 1 - slDistPct / 100 : 1 + slDistPct / 100);

        // Intelligence: If the exchange SL is further away than our estimate, it's likely the true initial SL.
        let initialSl = estimatedInitialSl;
        if (slPrice > 0) {
          const isFurther =
            direction === "LONG"
              ? slPrice < estimatedInitialSl
              : slPrice > estimatedInitialSl;
          if (isFurther) initialSl = slPrice;
        }

        let rrSequenceIndex = -1;
        let maxRrAchieved = 0;
        if (slPrice > 0 && config) {
          const tempTrade = {
            symbol: exPos.symbol,
            direction,
            entry_price: entryPrice,
            initial_sl: initialSl,
            rr_sequence_index: -1,
            max_rr_achieved: 0,
          } as Trade;
          rrSequenceIndex = this.tradingSessionService.reconcileMilestoneFromSl(
            tempTrade,
            slPrice,
            config,
          );
          maxRrAchieved = tempTrade.max_rr_achieved;
          this.logger.log(
            `[Reconciliation] Adopted ${exPos.symbol} reconciled milestone index: ${rrSequenceIndex}, peak RR: ${maxRrAchieved}`,
          );
        }

        let finalStopOrderId = slId;
        let finalStopOrderType = slType;
        let finalSlPrice = slPrice || initialSl;

        if (!slId && mode !== "paper") {
          this.logger.log(`[Reconciliation] Proactively placing Stop Loss order on exchange for adopted ${exPos.symbol} @ ${initialSl}`);
          try {
            const tempTrade = {
              symbol: exPos.symbol,
              direction,
              entry_price: entryPrice,
              qty,
              initial_sl: initialSl,
              current_sl: initialSl,
            } as any;
            const slResult = await this.orderManager.placeStopLoss(tempTrade, initialSl, entryPrice);
            if (slResult && slResult.orderId) {
              finalStopOrderId = slResult.orderId;
              finalStopOrderType = "algo";
              finalSlPrice = slResult.price;
              this.logger.log(`[Reconciliation] Successfully placed proactive SL on exchange for adopted ${exPos.symbol}: ${finalStopOrderId} @ ${finalSlPrice}`);
            }
          } catch (slPlaceErr) {
            this.logger.error(`[Reconciliation] Failed to place proactive SL on exchange for adopted ${exPos.symbol}: ${slPlaceErr instanceof Error ? slPlaceErr.message : String(slPlaceErr)}`);
          }
        }

        // Create synthetic trade for tracking/protection
        const syntheticTrade = this.tradeRepository.create({
          id: uuid(),
          symbol: exPos.symbol,
          direction,
          entry_price: entryPrice,
          qty,
          initial_sl: initialSl,
          current_sl: finalSlPrice,
          tp: tpPrice || null,
          rr_sequence_index: rrSequenceIndex,
          max_rr_achieved: maxRrAchieved,
          status: "OPEN" as any,
          sessionId: this.currentSessionId,
          entry_ts: new Date(),
          is_reconciliation: true,
          strategy_label: config?.strategy_label || "Exchange Reconciliation",
          strategy_config: {
            ...config,
            trading_mode: mode,
            paper_mode: mode === "paper",
          },
          close_attempts: 0,
          close_blocked: false,
          illiquid_blocked: false,
          binance_order_id: "RECON-" + uuid().substring(0, 8),
          binance_stop_order_id: finalStopOrderId,
          binance_stop_order_type: finalStopOrderType as any,
          pnl: 0,
          risk_usdt: roundEight(Math.abs(entryPrice - initialSl) * qty),
          initial_risk_usdt: roundEight(Math.abs(entryPrice - initialSl) * qty),
          mark_price: parseFloat(exPos.markPrice || "0") || entryPrice,
          last_price: entryPrice,
          updated_at: new Date(),
        });

        await this.tradeRepository.save(syntheticTrade);

        imported.push(syntheticTrade);
      } catch (innerErr) {
        this.logger.error(
          `[Reconciliation] Failed to adopt position for ${exPos.symbol}: ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`,
        );
      }
    }
    return imported;
  }

  private updateSessionPromiseChains: Map<string, Promise<any>> = new Map();

  async updateSession(
    id: string,
    partialConfig: Partial<SessionConfig>,
    ip?: string,
    userAgent?: string,
  ) {
    // Audit Item 13: Mutex/Promise chain to prevent race conditions during high-frequency config updates.
    // Scoped per-session to prevent global bottlenecks.
    const chain = this.updateSessionPromiseChains.get(id) || Promise.resolve();

    const next = chain
      .then(() => this.executeUpdateSession(id, partialConfig, ip, userAgent))
      .catch((e) => {
        // Log error but don't rethrow to avoid breaking the chain for subsequent updates.
        // We throw it inside a wrapper so the caller gets the error, but the chain itself recovers.
        this.logger.error(
          `Config update failed for session ${id}: ${e.message}`,
        );
        throw e;
      })
      .finally(() => {
        // Optional: clean up the map if this was the last update in the chain
      });

    this.updateSessionPromiseChains.set(
      id,
      next.catch(() => {}),
    ); // The chain itself must always be resolved for the next update
    return next;
  }

  private async executeUpdateSession(
    id: string,
    partialConfig: Partial<SessionConfig>,
    ip?: string,
    userAgent?: string,
  ) {
    const queryRunner =
      this.sessionRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 0. Lock Session row to serialize all updates and fetch latest state
      const session = await queryRunner.manager.findOne(SessionEntity, {
        where: { id },
        lock: { mode: "pessimistic_write" },
        select: ["id", "tradingMode", "paperMode", "config"],
      });

      if (!session) throw new NotFoundException("Session not found");

      // DATA-CONSISTENCY: Block modification of immutable fields while session is running
      if (this.sessionRunning && this.currentSessionId === id) {
        for (const field of SessionService.IMMUTABLE_SESSION_FIELDS) {
          const typedPartial = partialConfig as any;
          if (
            typedPartial[field] !== undefined &&
            typedPartial[field] !== session.config?.[field]
          ) {
            throw new BadRequestException(
              `Cannot modify ${field} while session is running`,
            );
          }
        }
      }

      // 1. Merge state instead of overwriting, strictly preserving the live mode and established paper mode
      const mergedConfig = {
        ...(session.config || {}),
        ...partialConfig,
        trading_mode: session.tradingMode,
        paper_mode: session.paperMode,
      };

      // Force consistency on update
      if (
        mergedConfig.trading_mode === "testnet" ||
        mergedConfig.trading_mode === "live"
      ) {
        mergedConfig.paper_mode = false;
      } else {
        mergedConfig.paper_mode = true;
      }

      // 2. Deep validation of full merged config
      // SEC-01: Re-apply DTO-level validation on the merged object to ensure data integrity
      const configInstance = plainToInstance(SessionConfig, mergedConfig);
      const errors = await validate(configInstance);
      if (errors.length > 0) {
        // SENTINEL: Extract non-sensitive metadata from validation errors for reporting
        const detailedErrors = formatValidationErrors(errors);
        // SENTINEL: Sanitize validation errors to mask 'value' fields containing sensitive inputs
        const sanitizedErrors = sanitize(errors);
        this.logger.warn(
          `Validation failed for merged config: ${JSON.stringify(sanitizedErrors)}`,
        );
        throw new BadRequestException({
          message: "Invalid configuration parameters",
          detail: detailedErrors,
        });
      }

      this.validateConfig(configInstance);

      // 3. Save updated config
      this.logger.log(
        `[Config Persistence] Saving updated config for session ${id}: frequency_shaping=${mergedConfig.frequency_shaping_enabled}, max_24h=${mergedConfig.max_trades_24h}, jitter=${mergedConfig.trades_jitter_pct}, spacing=${mergedConfig.min_trade_interval_min}`,
      );
      await queryRunner.manager.update(SessionEntity, id, {
        config: mergedConfig,
      });

      await queryRunner.commitTransaction();

      // 4. If this is the active session, hot-reload the config in the engine
      if (this.sessionRunning && this.currentSessionId === id) {
        updateLogLevels(!!mergedConfig.debug_mode);
        this.tradingSessionService.updateConfig(mergedConfig as SessionConfig);
      }

      await this.auditLog.log({
        action: "UPDATE_SESSION_CONFIG",
        resourceId: id,
        actor: ip,
        ip,
        userAgent,
        details: { partialConfig },
      });

      return { status: "updated", config: mergedConfig };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Transaction rolled back: Failed to update session ${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async pauseSession(paused: boolean, ip?: string, userAgent?: string) {
    if (!this.sessionRunning) throw new ConflictException("No session running");
    this.tradingSessionService.setPaused(paused);

    await this.auditLog.log({
      action: paused ? "PAUSE_SESSION" : "RESUME_SESSION",
      resourceId: this.currentSessionId || undefined,
      actor: ip,
      ip,
      userAgent,
    });

    return { status: paused ? "paused" : "resumed" };
  }

  async deleteSession(id: string, actor?: string, userAgent?: string) {
    // Security: Prevent deleting the active session
    if (this.sessionRunning && this.currentSessionId === id) {
      throw new ConflictException(
        "Cannot delete an active trading session. Stop it first.",
      );
    }

    await this.auditLog.log({
      action: "DELETE_SESSION",
      resourceId: id,
      actor,
      ip: actor,
      userAgent,
    });

    // Manually delete session, ensuring no cascade to trades (as there is no FK link in the current entity model)
    await this.sessionRepository.delete(id);
    return { status: "deleted" };
  }

  async deleteOrphanedTrades(actor?: string, userAgent?: string) {
    const sessions = await this.sessionRepository.find({ select: ["id"] });
    const sessionIds = sessions.map((s) => s.id);

    const queryBuilder = this.tradeRepository
      .createQueryBuilder()
      .delete()
      .where("sessionId IS NULL");

    if (sessionIds.length > 0) {
      queryBuilder.orWhere("sessionId NOT IN (:...ids)", { ids: sessionIds });
    }

    const result = await queryBuilder.execute();

    await this.auditLog.log({
      action: "DELETE_ORPHANED_TRADES",
      actor,
      ip: actor,
      userAgent,
      details: { affected: result.affected },
    });

    return { status: "deleted", affected: result.affected };
  }

  async listSessions() {
    return this.sessionRepository.find({
      order: { startTime: "DESC" },
      take: 20,
    });
  }

  async stopSession(ip?: string, userAgent?: string) {
    if (!this.sessionRunning || !this.currentSessionId) {
      throw new ConflictException("No session running");
    }

    const sessionId = this.currentSessionId;

    await this.sessionRepository.update(sessionId, {
      running: false,
      endTime: new Date(),
    });

    // Stop the actual trading engine
    await this.tradingSessionService.stop();

    // Reset log levels to default when session stops
    updateLogLevels(false);

    this.logger.log(`Stopping trading session.`);
    this.sessionRunning = false;
    this.currentSessionId = null;

    await this.auditLog.log({
      action: "STOP_SESSION",
      resourceId: sessionId,
      actor: ip,
      ip,
      userAgent,
    });

    return { status: "stopped" };
  }

  async getStatus() {
    if (!this.currentSessionId) {
      const activeSession = await this.sessionRepository.findOne({
        where: { running: true },
        order: { startTime: "DESC" },
      });
      if (activeSession) {
        this.currentSessionId = activeSession.id;
        this.sessionRunning = true;
      } else {
        // No active session, but we want to return the last known state and global balance
        const lastSession = await this.sessionRepository.findOne({
          where: {},
          order: { startTime: "DESC" },
        });
        const settings = await this.settingsRepository.findOne({
          where: { id: "default" },
        });

        // Determine which balance to show based on last session mode, defaulting to paper
        const mode =
          lastSession?.tradingMode ||
          (lastSession?.paperMode === false ? "live" : "paper");
        let balance = 10000;
        if (settings) {
          if (mode === "paper") balance = Number(settings.paper_balance);
          else if (mode === "testnet")
            balance = Number(settings.testnet_balance);
          else if (mode === "live") balance = Number(settings.live_balance);
        }

        return {
          running: false,
          balance,
          tradingMode: mode,
          paperMode: mode === "paper",
          config: lastSession?.config || null,
        };
      }
    }

    const session = await this.sessionRepository.findOne({
      where: { id: this.currentSessionId },
    });
    if (!session) return { running: false };

    const engineStatus: any = this.tradingSessionService.getStatus();
    const activeTrades = (
      await this.tradeRepository.find({
        where: { status: "OPEN", sessionId: session.id },
      })
    ).filter(
      (trade) =>
        trade.entry_price != null &&
        !isNaN(Number(trade.entry_price)) &&
        trade.qty != null &&
        !isNaN(Number(trade.qty)),
    );

    const logs = await this.logRepository.find({
      where: { sessionId: session.id },
      order: { ts: "DESC" },
      take: 100,
    });

    return {
      running: session.running,
      paused: engineStatus.paused,
      strategyId: session.id,
      paperMode: session.paperMode,
      tradingMode: session.tradingMode,
      balance: engineStatus.running
        ? session.paperMode
          ? engineStatus.balance_paper
          : engineStatus.balance_live
        : session.balance,
      totalPnl: engineStatus.running
        ? engineStatus.total_pnl
        : session.totalPnl,
      logLines: logs,
      activeTrades: engineStatus.activeTrades?.length
        ? engineStatus.activeTrades
        : activeTrades,
      scannerResults: engineStatus.scannerResults,
      activeWindows: engineStatus.activeWindows,
      gateState: engineStatus.gateState,
      scannerPaused: engineStatus.scannerPaused,
      history: (await this.getHistory(session.id)).trades || [],
      totalRiskPct: session.paperMode
        ? engineStatus.balance_paper > 0
          ? (engineStatus.total_risk / engineStatus.balance_paper) * 100
          : 0
        : engineStatus.balance_live > 0
          ? (engineStatus.total_risk / engineStatus.balance_live) * 100
          : 0,
      totalSlUsed: engineStatus.total_risk,
      apiStatus: engineStatus.apiStatus,
      config: session.config,
      startTime: session.startTime,
    };
  }

  async getHistory(sessionId?: string) {
    // If no sessionId is provided, we default to the current session ID if one is running.
    // If we want GLOBAL history (all sessions), we must explicitly pass 'all' or similar.
    const filterId =
      sessionId === "all" ? undefined : sessionId || this.currentSessionId;

    const closedTrades = await this.tradeRepository.find({
      where: {
        status: In(TERMINAL_STATUSES as any),
        ...(filterId ? { sessionId: filterId } : {}),
      },
      order: { exit_ts: "DESC" },
      take: 200,
    });

    return { trades: closedTrades };
  }

  async getAnalytics() {
    const now = Date.now();
    if (
      this.analyticsCache &&
      now - this.analyticsCache.ts < this.CACHE_TTL_MS
    ) {
      return this.analyticsCache.data;
    }

    // Performance Engineering: Fetch current session status first (contains both balance and history)
    // This allows us to reuse memory and avoid separate DB hits for balance vs trades.
    const currentStatus = await this.getStatus();

    let trades: any[];
    let startingBalance: number | undefined;
    let currentBalance: number | undefined;

    if (this.currentSessionId && currentStatus.running) {
      // Reuse history already fetched in getStatus() to minimize DB load
      trades = currentStatus.history || [];
      startingBalance = currentStatus.config?.paper_mode
        ? currentStatus.config?.paper_starting_balance
        : currentStatus.config?.live_starting_balance;
      currentBalance = currentStatus.balance;
    } else {
      // Fallback for global analytics or inactive sessions
      trades = await this.tradeRepository.find({
        select: [
          "id", "pnl", "exit_ts", "status", "max_rr_achieved", "min_rr_achieved", "exit_rr",
          "is_reconciliation", "initial_risk_usdt", "risk_usdt", "entry_price", "current_sl", "initial_sl", "qty"
        ],
        where: {
          status: In(TERMINAL_STATUSES as any),
          ...(this.currentSessionId
            ? { sessionId: this.currentSessionId }
            : {}),
        },
      });
      startingBalance = this.currentSessionId
        ? await this.getStartingBalanceForSession(this.currentSessionId)
        : undefined;
      currentBalance = currentStatus.balance;
    }

    // SRE: Provide stable fallback startingBalance (10000) if undefined to prevent metrics/drawdowns from being distorted by deposits/withdrawals.
    const result = this.analyticsService.calculateAnalytics(
      trades as any,
      startingBalance || 10000,
      currentStatus.balance,
    );

    // BOLT: Add RR optimization data to analytics response
    try {
      result.rrOptimization =
        this.rrOptimizationService.calculateRrOptimization(trades as any);
    } catch (e) {
      this.logger.warn(
        `Failed to calculate RR optimization: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    this.analyticsCache = { data: result, ts: now };
    return result;
  }

  private async getStartingBalanceForSession(
    sessionId: string,
  ): Promise<number | undefined> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      select: ["config", "tradingMode", "paperMode"],
    });
    if (!session || !session.config) return undefined;
    const mode = session.tradingMode || (session.paperMode ? "paper" : "live");
    if (mode === "paper") return session.config.paper_starting_balance;
    if (mode === "testnet")
      return (session.config as any).testnet_starting_balance;
    return session.config.live_starting_balance;
  }

  async getBinanceRateLimit() {
    return this.tradingSessionService.getBinanceRateLimit();
  }

  async getTrade(idOrSymbol: string) {
    return this.tradingSessionService.getTrade(idOrSymbol);
  }

  // WebSocket broadcaster
  setBroadcaster(callback: (data: any) => void) {
    this.wsBroadcaster = callback;
    this.tradingSessionService.setWsBroadcaster(callback);
  }

  // Broadcast event to WebSocket clients
  broadcastEvent(eventType: string, payload: any) {
    if (this.wsBroadcaster) {
      try {
        this.wsBroadcaster({ type: eventType, ...payload });
      } catch (err) {
        this.logger.error(
          `Broadcast error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Manually close a trade
  async closeTradeManually(symbol: string, actor?: string, userAgent?: string) {
    if (!this.sessionRunning) {
      throw new ConflictException("No session running");
    }

    const result = await this.tradingSessionService.closeTradeManually(symbol);

    if (result.success && result.trade) {
      this.logger.log(`Manually closed trade ${symbol}`);

      await this.auditLog.log({
        action: "MANUAL_TRADE_CLOSE",
        resourceId: result.trade.id,
        actor,
        ip: actor,
        userAgent,
        details: { symbol, tradeId: result.trade.id },
      });
    }

    return result;
  }

  /**
   * Cleanup task for old database records (Logs and closed Trades)
   */
  private async cleanupOldData() {
    try {
      const settings = await this.settingsRepository.findOne({
        where: { id: "default" },
      });
      const logRetentionDays = (settings as any)?.log_retention_days || 7;
      const tradeRetentionDays = (settings as any)?.trade_retention_days || 30;
      const klineRetentionDays = 7;

      const logCutoff = new Date(
        Date.now() - logRetentionDays * 24 * 60 * 60 * 1000,
      );
      const tradeCutoff = new Date(
        Date.now() - tradeRetentionDays * 24 * 60 * 60 * 1000,
      );

      const deletedLogs = await this.logRepository
        .createQueryBuilder()
        .delete()
        .where("ts < :cutoff", { cutoff: logCutoff.toISOString() })
        .execute();

      const deletedTrades = await this.tradeRepository
        .createQueryBuilder()
        .delete()
        .where("exit_ts < :cutoff", { cutoff: tradeCutoff })
        .andWhere("status IN (:...statuses)", { statuses: TERMINAL_STATUSES })
        .execute();

      // SEC-02: Cleanup old kline data to prevent unbounded storage growth
      const klineCutoff = Date.now() - klineRetentionDays * 24 * 60 * 60 * 1000;
      const deletedKlines = await this.sessionRepository.manager
        .createQueryBuilder()
        .delete()
        .from("klines")
        .where("time < :cutoff", { cutoff: klineCutoff })
        .execute();

      // SENTINEL: Also cleanup audit logs periodically
      const auditRetentionDays = (settings as any)?.audit_retention_days || 90;
      const deletedAudit = await this.auditLog.cleanup(auditRetentionDays);

      // SENTINEL: Implement memory cleanup for session-specific trackers to prevent memory exhaustion
      // Iterate through the maps and remove entries for sessions that are no longer running.
      const runningSessions = await this.sessionRepository.find({
        where: { running: true },
        select: ["id"],
      });
      const runningIds = new Set(runningSessions.map((s) => s.id));
      if (this.currentSessionId) runningIds.add(this.currentSessionId);

      let logRateLimitCleared = 0;
      for (const sid of this.logRateLimits.keys()) {
        if (!runningIds.has(sid)) {
          this.logRateLimits.delete(sid);
          logRateLimitCleared++;
        }
      }

      let sessionLogCountCleared = 0;
      for (const sid of this.sessionLogCounts.keys()) {
        if (!runningIds.has(sid)) {
          this.sessionLogCounts.delete(sid);
          sessionLogCountCleared++;
        }
      }

      this.logger.log(
        `Cleanup completed: ${deletedLogs.affected || 0} logs, ${deletedTrades.affected || 0} trades, ${deletedKlines.affected || 0} klines, and ${deletedAudit || 0} audit entries removed. Tracker memory cleared for ${logRateLimitCleared + sessionLogCountCleared} stale sessions.`,
      );
    } catch (e: any) {
      this.logger.error(`Data cleanup failed: ${e.message}`);
    }
  }

  // Add log line
  async logMessage(msg: string, level: "info" | "warn" | "error" = "info") {
    if (!this.currentSessionId) return;

    // SENTINEL: Truncate message to prevent excessive database growth from oversized logs
    const sanitizedMsg =
      msg && msg.length > 4000
        ? msg.substring(0, 4000) + "... [truncated]"
        : msg;

    const sid = this.currentSessionId;

    // Broadcast to UI immediately for real-time visibility
    this.broadcastEvent("log", {
      msg: sanitizedMsg,
      level,
      ts: new Date().toISOString(),
    });

    const now = Date.now();

    // SENTINEL: Per-session log rate limiting (max 60 logs per minute) to prevent resource exhaustion
    const rateLimit = this.logRateLimits.get(sid) || {
      count: 0,
      resetAt: now + 60000,
    };
    if (now > rateLimit.resetAt) {
      rateLimit.count = 0;
      rateLimit.resetAt = now + 60000;
    }
    rateLimit.count++;
    this.logRateLimits.set(sid, rateLimit);

    if (rateLimit.count > 60) {
      if (rateLimit.count === 61) {
        this.logger.warn(
          `Log rate limit (60/min) exceeded for session ${sid}. Further logs suppressed.`,
        );
      }
      return;
    }

    // SENTINEL: Use in-memory counter to enforce cap (2000 logs) and avoid DB overhead
    let logCount = this.sessionLogCounts.get(sid);
    if (logCount === undefined) {
      logCount = await this.logRepository.count({ where: { sessionId: sid } });
      this.sessionLogCounts.set(sid, logCount);
    }

    if (logCount >= 2000) {
      // If we already have many logs for this session, we only keep errors
      if (level !== "error") return;
      // For errors, we delete the oldest log before inserting a new one
      const oldest = await this.logRepository.findOne({
        where: { sessionId: sid },
        order: { ts: "ASC" },
      });
      if (oldest) {
        await this.logRepository.delete(oldest.id);
        logCount--;
      }
    }

    this.sessionLogCounts.set(sid, logCount + 1);

    await this.logRepository.insert({
      sessionId: this.currentSessionId,
      ts: new Date().toISOString(),
      level,
      msg: sanitizedMsg,
    });
  }

  /**
   * Directly sets the binance client on the underlying trading service.
   * Useful for reconciliation before the full engine start.
   */
  setBinanceClient(client: any, paperMode: boolean) {
    this.tradingSessionService.setBinanceClient(client, paperMode);
  }

  /**
   * Proactively starts the user data stream to begin buffering events during reconciliation.
   */
  async startUds(client: any) {
    await this.tradingSessionService.startUds(client);
  }

  async resetPaperBalance(actor?: string, userAgent?: string) {
    const defaultBalance = 10000.0;

    await this.auditLog.log({
      action: "RESET_PAPER_BALANCE",
      actor,
      ip: actor,
      userAgent,
      details: { balance: defaultBalance },
    });

    await this.settingsRepository.update("default", {
      paper_balance: defaultBalance,
    });

    // Record reset in history
    await this.balanceHistoryRepository.save({
      timestamp: new Date(),
      balance: defaultBalance,
      pnl: 0,
      type: "RESET",
    });

    // If a session is running and it's paper mode, we might want to update it,
    // but usually, a reset is done when no session is active or as a hard override.
    if (this.sessionRunning) {
      const session = await this.sessionRepository.findOne({
        where: { id: this.currentSessionId! },
      });
      if (session && session.paperMode) {
        // Hot update the engine if running
        this.tradingSessionService.updatePaperBalance(defaultBalance);
      }
    }

    return { status: "reset", balance: defaultBalance };
  }

  async getLifetimeAnalytics(mode: "paper" | "testnet" | "live" = "paper") {
    // 1. Fetch all closed trades across all sessions for the specific mode
    const trades = await this.tradeRepository.find({
      select: [
        "id", "pnl", "exit_ts", "status", "max_rr_achieved", "min_rr_achieved", "exit_rr",
        "is_reconciliation", "initial_risk_usdt", "risk_usdt", "entry_price", "current_sl", "initial_sl", "qty",
        "strategy_config", "strategy_label"
      ],
      where: {
        status: In(TERMINAL_STATUSES as any),
      },
      order: { exit_ts: "ASC" },
    });

    // Filter trades by mode
    const filteredTrades = trades.filter((t) => {
      const tConfig = t.strategy_config || {};
      const tMode =
        tConfig.trading_mode ||
        (tConfig.paper_mode === false ? "live" : "paper");
      return tMode === mode;
    });

    // 2. Fetch balance history snapshots for high-fidelity curve
    const history = await this.balanceHistoryRepository.find({
      where: { tradingMode: mode as any },
      order: { timestamp: "ASC" },
    });

    // 3. Calculate analytics using the full trade set
    // We assume the very first starting balance was 10000 for paper, and 10000 for live if history is empty, to prevent division-by-zero or astronomical drawdowns.
    const startingBalance =
      mode === "paper"
        ? 10000
        : history.length > 0
          ? Number(history[0].balance) - Number(history[0].pnl)
          : 10000;
    const analytics = this.analyticsService.calculateAnalytics(
      filteredTrades as any,
      startingBalance,
    );

    // BOLT: Add RR optimization data to lifetime analytics
    try {
      analytics.rrOptimization =
        this.rrOptimizationService.calculateRrOptimization(
          filteredTrades as any,
        );
    } catch (e) {
      this.logger.warn(
        `Failed to calculate lifetime RR optimization: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // 4. Skip overriding cumulative PnL with h.balance to prevent exchange deposits/withdrawals from distorting metrics and charts.
    // The trade-by-trade cumulative PnL calculated above is purely performance-based and completely immune to funding changes.

    return analytics;
  }
}
