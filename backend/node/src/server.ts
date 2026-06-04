import { NestFactory, HttpAdapterHost } from "@nestjs/core";
import { ValidationPipe, LogLevel, Logger } from "@nestjs/common";
import { Request, Response, NextFunction, json, urlencoded } from "express";
import { DynamicLogger } from "./lib/logger";
import { ConfigService } from "@nestjs/config";
import { WebSocketServer } from "ws";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./lib/all-exceptions.filter";
import { safeCompare } from "./lib/crypto";
import { isThrottled, recordFailure, clearFailures, extractIp } from "./lib/throttle";
import { ENGINE_CONSTANTS } from "./models/constants";
import { SessionService } from "./trading/session.service";
import { MonitoringService } from "./engine/monitoring.service";
import { TradingSessionService } from "./engine/trading_session.service";

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === "production";
  const forceDebug = process.env.DEBUG === "true";

  // Default to quiet logs even in dev, unless forceDebug is set.
  // DynamicLogger will upgrade these levels at runtime if a session starts with debug_mode: true.
  const logLevels: LogLevel[] = forceDebug
    ? ["log", "error", "warn", "debug", "verbose"]
    : ["log", "warn", "error"];

  const logger = DynamicLogger.getInstance();
  logger.setLogLevels(logLevels);

  const app = await NestFactory.create(AppModule, {
    logger,
    bodyParser: false, // Disable default body parser to configure limits manually
  });

  // Security: Disable X-Powered-By header to reduce information disclosure
  app.getHttpAdapter().getInstance().disable("x-powered-by");

  // Security: Limit JSON and URL-encoded payload size to prevent DoS attacks
  app.use(json({ limit: ENGINE_CONSTANTS.HTTP_BODY_LIMIT }));
  app.use(urlencoded({ limit: ENGINE_CONSTANTS.HTTP_BODY_LIMIT, extended: true }));

  const configService = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Audit Item 33: Global structured error tracking
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));

  const allowedOrigins = configService
    .get<string>("ALLOWED_ORIGINS")
    ?.split(",")
    .map((o) => o.trim()) || [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ];

  const nodeEnv = configService.get<string>("NODE_ENV");
  const serverLogger = new Logger("Server");
  serverLogger.log(`🔒 Allowed Origins: ${allowedOrigins.join(", ")}`);

  // Security Headers Middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests;",
    );
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    if (nodeEnv === "production") {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
    next();
  });

  // Enable CORS for frontend
  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);

      const normalizedOrigin = origin.replace(/\/$/, "");
      const isAllowed = allowedOrigins.some(
        (o) => o.replace(/\/$/, "") === normalizedOrigin,
      );
      const isDevFallback = !isAllowed && nodeEnv !== "production";

      if (isAllowed || isDevFallback) {
        if (isDevFallback) {
          serverLogger.warn(
            `⚠️  Security Warning: Allowing unauthorized origin "${origin}" due to non-production environment.`,
          );
        }
        callback(null, true);
      } else {
        serverLogger.warn(`CORS blocked for origin: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  });

  // Health check endpoint
  app.getHttpAdapter().get("/health", async (req, res) => {
    try {
      // Audit Item 35: Add DB health check
      const entityManager = app.get("EntityManager");
      await entityManager.query("SELECT 1");
      res.status(200).send({ status: "ok", db: "connected", timestamp: new Date().toISOString() });
    } catch (e) {
      res.status(503).send({ status: "error", db: "disconnected", timestamp: new Date().toISOString() });
    }
  });

  // SENTINEL: Disable 'Server' header to further reduce information disclosure
  app.getHttpAdapter().getInstance().use((req: Request, res: Response, next: NextFunction) => {
    res.removeHeader("Server");
    next();
  });

  await app.init();
  const httpServer = app.getHttpServer();
  const sessionService = app.get(SessionService);
  const monitoringService = app.get(MonitoringService);

  const wss = new WebSocketServer({
    server: httpServer,
    path: "/session/ws",
    perMessageDeflate: {
      zlibDeflateOptions: {
        chunkSize: 1024,
        memLevel: 7,
        level: 3,
      },
      zlibInflateOptions: {
        chunkSize: 10 * 1024,
      },
      clientNoContextTakeover: true,
      serverNoContextTakeover: true,
      serverMaxWindowBits: 10,
      concurrencyLimit: 10,
      threshold: 1024,
    },
    verifyClient: (info, done) => {
      const origin = info.origin ? info.origin.replace(/\/$/, "") : null;
      const isOriginAllowed =
        !origin || allowedOrigins.some((o) => o.replace(/\/$/, "") === origin);
      const isDevFallback = !isOriginAllowed && nodeEnv !== "production";
      const clientIp = extractIp(info.req.headers, info.req.socket.remoteAddress || "unknown");

      // SENTINEL: Check WS IP throttle
      if (isThrottled(clientIp)) {
        serverLogger.warn(`WS Auth throttle triggered for IP: ${clientIp}`);
        return done(false, 429, "Too many failed attempts");
      }

      if (!isOriginAllowed && !isDevFallback) {
        serverLogger.warn(
          `Blocked WebSocket connection from unauthorized origin: ${info.origin} (IP: ${clientIp})`,
        );
        return done(false);
      } else if (isDevFallback) {
        serverLogger.warn(
          `⚠️  Security Warning: Allowing unauthorized WebSocket origin "${info.origin}" due to non-production environment.`,
        );
      }

      // Security: Validate API Key if ADMIN_API_KEY is configured
      const adminKey = configService.get<string>("ADMIN_API_KEY");
      if (adminKey) {
        try {
          const url = new URL(
            info.req.url || "",
            `http://${info.req.headers.host}`,
          );
          const token = url.searchParams.get("token");

          // SENTINEL: Validate token length and presence
          if (!token || token.length > 128) {
             serverLogger.warn(
               `Blocked WebSocket connection: Invalid API Key format/length from ${info.origin} (IP: ${clientIp})`,
             );
             return done(false);
          }

          if (!safeCompare(token, adminKey)) {
            serverLogger.warn(
              `Blocked WebSocket connection: Invalid API Key from ${info.origin} (IP: ${clientIp})`,
            );
            recordFailure(clientIp);
            return done(false);
          }
          clearFailures(clientIp);
        } catch (err) {
          serverLogger.error(`WebSocket handshake URL parsing failed for ${info.origin} (IP: ${clientIp})`);
          return done(false);
        }
      } else if (nodeEnv === "production") {
        serverLogger.error(
          "Blocked WebSocket connection: ADMIN_API_KEY is missing in production environment.",
        );
        return done(false);
      } else {
        serverLogger.warn(
          "⚠️  Security Warning: WebSocket connection allowed without ADMIN_API_KEY in non-production environment.",
        );
      }

      done(true);
    },
  });

  // Heartbeat interval to detect and terminate zombie connections
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws: any) => {
      if (ws.isAlive === false) {
        serverLogger.warn("Terminating zombie WebSocket connection");
        return ws.terminate();
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, ENGINE_CONSTANTS.WS_HEARTBEAT_INTERVAL_MS);

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  const updateMonitoringSuppression = () => {
    const clients = Array.from(wss.clients);
    const anyActive = clients.some((c: any) => c.monitoringEnabled !== false);
    monitoringService.setEnabled(anyActive);

    // Synchronize listener count for loop optimization
    const tradingSessionService = app.get(TradingSessionService);
    const activeCount = clients.filter((c: any) => c.isActive !== false).length;
    tradingSessionService.setListenerCount(activeCount);
    const dashCount = clients.filter(
      (c: any) => c.isActive !== false && !c.focusMode,
    ).length;
    tradingSessionService.setDashboardCount(dashCount);
  };

  sessionService.setBroadcaster((data: any) => {
    const isString = typeof data === "string";
    let basePayload: any;
    let cachedJson: string | null = isString ? (data as string) : null;

    const getPayload = () => {
      if (!basePayload) {
        basePayload = isString ? JSON.parse(data as string) : data;
      }
      return basePayload;
    };

    wss.clients.forEach((client: any) => {
      if (client.readyState !== client.OPEN) return;

      const payload = getPayload();

      // Optimization: Skip ticks, scanner, and logs for inactive (background) clients to save network egress
      if (
        client.isActive === false &&
        (payload.type === "tick" ||
          payload.type === "scanner" ||
          payload.type === "log")
      ) {
        return;
      }

      if (payload.type === "scanner" && client.focusMode === true) return;

      if (payload.type === "tick") {
        const tick = { ...payload };

          // BOLT: Tiered Data Fidelity Logic
        if (tick.trades && Array.isArray(tick.trades)) {
          tick.trades = tick.trades.map((trade: any) => {
              // 1. Full Fidelity: ONLY for a specific focused trade ID
              const isFullFidelity = client.focusMode && client.focusTradeId === trade.id;

              // 2. Mid Fidelity: For a strategy list or the global trades view
              const isMidFidelity = client.focusMode &&
                (client.focusTradeId === "all" || client.focusStrategyLabel === trade.strategy_label);

              if (isFullFidelity) {
                return trade;
              }

              // Strip heavy diagnostics for everyone else
              const {
                strategy_config,
                live_rr_sequence,
                exit_rr_sequence,
                exit_signals_status,
                sl_adjustments,
                tp_mode,
                tp_ratio,
                exit_signal_logic,
                ...thinTrade
              } = trade;

              if (isMidFidelity) {
                return {
                  ...thinTrade,
                  live_rr_sequence: trade.live_rr_sequence,
                  exit_rr_sequence: trade.exit_rr_sequence,
                  _thin: true,
                };
            }

              // Low Fidelity: For Dashboard overview (No sequences, no logs)
              return { ...thinTrade, _thin: true };
          });
        }

        if (!client.focusMode) {
          tick.activeWindows = [];
        }

        if (client.monitoringEnabled === false) {
          delete tick.monitoring;
        }

        client.send(JSON.stringify(tick));
        return;
      }

      if (payload.type === "scanner") {
        // Optimization: Prune sparkline history for Dashboard to save bandwidth
        if (!client.focusMode) {
          const pruned = {
            ...payload,
            opportunities: (payload.opportunities || []).map((o: any) => {
              const { history, signalResult, ...thin } = o;
              return thin;
            }),
            variant_opportunities: (
              basePayload.variant_opportunities || []
            ).map((v: any) => ({
              ...v,
              opportunities: (v.opportunities || []).map((o: any) => {
                const { history, signalResult, ...thin } = o;
                return thin;
              }),
            })),
          };
          client.send(JSON.stringify(pruned));
          return;
        }
      }
      if (payload.type === "log" && client.logFilters) {
        if (client.logFilters[payload.level] === false) return;
      }

      if (
        payload.type === "status" &&
        client.logFilters &&
        Array.isArray(payload.logLines)
      ) {
        const filteredPayload = {
          ...payload,
          logLines: payload.logLines.filter(
            (log: any) => client.logFilters[log.level] !== false,
          ),
        };
        client.send(JSON.stringify(filteredPayload));
        return;
      }

      if (!cachedJson) {
        cachedJson = JSON.stringify(payload);
      }
      client.send(cachedJson);
    });
  });

  wss.on("connection", async (socket: any) => {
    // Security/Stability: Every socket MUST have an error handler to prevent process crashes
    socket.on("error", (err: Error) => {
      serverLogger.error(`WebSocket socket error: ${err.message}`);
    });

    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.monitoringEnabled = true;
    socket.focusMode = false;
    socket.focusTradeId = null;
    socket.focusStrategyLabel = null;
    socket.isActive = true; // Default to active on connect
    socket.logFilters = { info: true, warn: true, error: true };
    socket.msgCount = 0;
    socket.lastReset = Date.now();
    socket.lockoutUntil = 0; // Audit Item 31: Lockout for rate limiting
    updateMonitoringSuppression();

    socket.on("message", async (message: string) => {
      try {
        const now = Date.now();

        // Audit Item 31: 5s backoff lockout on rate limit breach
        if (now < socket.lockoutUntil) return;

        // Rate limiting: max 20 messages per second
        if (now - socket.lastReset > 1000) {
          socket.msgCount = 0;
          socket.lastReset = now;
        }
        socket.msgCount++;
        if (socket.msgCount > 20) {
          serverLogger.warn(`Rate limit exceeded for client. Locking out for 5s.`);
          socket.lockoutUntil = now + 5000;
          return;
        }

        if (message.length > 1000) return;

        let data;
        try {
          data = JSON.parse(message);
        } catch (e) {
          serverLogger.warn("Received malformed WebSocket JSON payload");
          return;
        }

        if (!data || typeof data !== "object") return;

        if (data.type === "set_monitoring") {
          socket.monitoringEnabled = data.enabled === true;
          updateMonitoringSuppression();
        }
        if (data.type === "set_focus_mode") {
          const wasFocused = socket.focusMode;
          socket.focusMode = data.enabled === true;
          socket.focusTradeId = data.tradeId || null;
          socket.focusStrategyLabel = data.strategyLabel || null;

          // If becoming focused, immediately broadcast the current session state to the client
          // to prevent UI "data gaps" during transition.
          if (!wasFocused && socket.focusMode) {
            const tradingSessionService = app.get(TradingSessionService);
            const status = tradingSessionService.getStatus();
            socket.send(JSON.stringify({
              type: "status",
              ...status,
              _forced: true
            }));
          }
        }
        if (data.type === "set_active") {
          const wasActive = socket.isActive;
          socket.isActive = data.active === true;
          // If state changed, update backend listener count for loop optimization
          if (wasActive !== socket.isActive) {
            updateMonitoringSuppression();
          }
          // If becoming active again, send full status to sync state
          if (!wasActive && socket.isActive) {
            socket.send(
              JSON.stringify({
                type: "status",
                ...(await sessionService.getStatus()),
              }),
            );
          }
        }
        if (
          data.type === "set_log_filters" &&
          typeof data.filters === "object" &&
          data.filters !== null
        ) {
          socket.logFilters = {
            info: data.filters.info === true,
            warn: data.filters.warn === true,
            error: data.filters.error === true,
          };
        }
      } catch (e) {}
    });

    socket.on("close", () => {
      updateMonitoringSuppression();
    });

    socket.send(
      JSON.stringify({ type: "status", ...(await sessionService.getStatus()) }),
    );
  });

  const port = process.env.PORT || configService.get<number>("PORT") || 3000;
  await app.listen(port, "0.0.0.0");

  serverLogger.log(`✨ Trading Dashboard Backend running on port ${port}`);
  serverLogger.log(`📡 WebSocket endpoint: ws://0.0.0.0:${port}/session/ws`);
}

bootstrap().catch((err) => {
  const bootstrapLogger = new Logger("Bootstrap");
  bootstrapLogger.error("Server startup failed:", err);
  process.exit(1);
});
