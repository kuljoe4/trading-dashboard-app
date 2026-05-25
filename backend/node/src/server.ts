import { NestFactory } from '@nestjs/core';
import { ValidationPipe, LogLevel } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import { WebSocketServer } from 'ws';
import { AppModule } from './app.module';
import { SessionService } from './trading/session.service';
import { MonitoringService } from './engine/monitoring.service';
import { TradingSessionService } from './engine/trading_session.service';

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === 'production';
  const forceDebug = process.env.DEBUG === 'true';

  const logLevels: LogLevel[] = isProduction && !forceDebug
    ? ['log', 'warn', 'error']
    : ['log', 'error', 'warn', 'debug', 'verbose'];

  const app = await NestFactory.create(AppModule, {
    logger: logLevels,
  });
  const configService = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const allowedOrigins = configService.get<string>('ALLOWED_ORIGINS')?.split(',').map((o) => o.trim()) || [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://frontend-production-9bcd.up.railway.app', // Adding your specific frontend domain
  ];

  const nodeEnv = configService.get<string>('NODE_ENV');
  console.log(`🔒 Allowed Origins: ${allowedOrigins.join(', ')}`);

  // Security Headers Middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none';");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (nodeEnv === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // Enable CORS for frontend
  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);
      
      const isAllowed = allowedOrigins.indexOf(origin) !== -1;
      const isDevFallback = !isAllowed && nodeEnv !== 'production';

      if (isAllowed || isDevFallback) {
        if (isDevFallback) {
          console.warn(`⚠️  Security Warning: Allowing unauthorized origin "${origin}" due to non-production environment.`);
        }
        callback(null, true);
      } else {
        console.warn(`CORS blocked for origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  });

  // Health check endpoint
  app.getHttpAdapter().get('/health', (req, res) => {
    res.status(200).send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  await app.init();
  const httpServer = app.getHttpServer();
  const sessionService = app.get(SessionService);
  const monitoringService = app.get(MonitoringService);

  const wss = new WebSocketServer({
    server: httpServer,
    path: '/session/ws',
    perMessageDeflate: {
      zlibDeflateOptions: {
        chunkSize: 1024,
        memLevel: 7,
        level: 3,
      },
      zlibInflateOptions: {
        chunkSize: 10 * 1024
      },
      clientNoContextTakeover: true,
      serverNoContextTakeover: true,
      serverMaxWindowBits: 10,
      concurrencyLimit: 10,
      threshold: 1024,
    },
    verifyClient: (info, done) => {
      const origin = info.origin ? info.origin.replace(/\/$/, '') : null;
      const isAllowed = !origin || allowedOrigins.some(o => o.replace(/\/$/, '') === origin);
      const isDevFallback = !isAllowed && nodeEnv !== 'production';

      if (!isAllowed && !isDevFallback) {
        console.warn(`Blocked WebSocket connection from unauthorized origin: ${info.origin}`);
      } else if (isDevFallback) {
        console.warn(`⚠️  Security Warning: Allowing unauthorized WebSocket origin "${info.origin}" due to non-production environment.`);
      }
      done(isAllowed || isDevFallback);
    },
  });

  const updateMonitoringSuppression = () => {
    const clients = Array.from(wss.clients);
    const anyActive = clients.some((c: any) => c.monitoringEnabled !== false);
    monitoringService.setEnabled(anyActive);
    
    // Synchronize listener count for loop optimization
    const tradingSessionService = app.get(TradingSessionService);
    const activeCount = clients.filter((c: any) => c.isActive !== false).length;
    tradingSessionService.setListenerCount(activeCount);
  };

  sessionService.setBroadcaster((data: any) => {
    const basePayload = typeof data === 'string' ? JSON.parse(data) : data;
    
    wss.clients.forEach((client: any) => {
      if (client.readyState !== client.OPEN) return;

      // Optimization: Skip ticks, scanner, and logs for inactive (background) clients to save network egress
      if (client.isActive === false && (basePayload.type === 'tick' || basePayload.type === 'scanner' || basePayload.type === 'log')) {
        return;
      }

      if (basePayload.type === 'scanner' && client.focusMode === true) return;

      if (basePayload.type === 'tick' && client.monitoringEnabled === false) {
        const stripped = { ...basePayload };
        delete stripped.monitoring;
        client.send(JSON.stringify(stripped));
        return;
      }

      if (basePayload.type === 'log' && client.logFilters) {
        if (client.logFilters[basePayload.level] === false) return;
      }

      if (basePayload.type === 'status' && client.logFilters && Array.isArray(basePayload.logLines)) {
        const filteredPayload = {
          ...basePayload,
          logLines: basePayload.logLines.filter((log: any) => client.logFilters[log.level] !== false),
        };
        client.send(JSON.stringify(filteredPayload));
        return;
      }

      client.send(JSON.stringify(basePayload));
    });
  });

  wss.on('connection', async (socket: any) => {
    socket.monitoringEnabled = true;
    socket.focusMode = false;
    socket.isActive = true; // Default to active on connect
    socket.logFilters = { info: true, warn: true, error: true };
    socket.msgCount = 0;
    socket.lastReset = Date.now();
    updateMonitoringSuppression();
    
    socket.on('message', async (message: string) => {
      try {
        // Rate limiting: max 20 messages per second
        const now = Date.now();
        if (now - socket.lastReset > 1000) {
          socket.msgCount = 0;
          socket.lastReset = now;
        }
        socket.msgCount++;
        if (socket.msgCount > 20) return;

        if (message.length > 1000) return;

        let data;
        try {
          data = JSON.parse(message);
        } catch (e) {
          console.warn('Received malformed WebSocket JSON payload');
          return;
        }

        if (!data || typeof data !== 'object') return;

        if (data.type === 'set_monitoring') {
          socket.monitoringEnabled = data.enabled === true;
          updateMonitoringSuppression();
        }
        if (data.type === 'set_focus_mode') {
          socket.focusMode = data.enabled === true;
        }
        if (data.type === 'set_active') {
          const wasActive = socket.isActive;
          socket.isActive = data.active === true;
          // If state changed, update backend listener count for loop optimization
          if (wasActive !== socket.isActive) {
            updateMonitoringSuppression();
          }
          // If becoming active again, send full status to sync state
          if (!wasActive && socket.isActive) {
             socket.send(JSON.stringify({ type: 'status', ...(await sessionService.getStatus()) }));
          }
        }
        if (data.type === 'set_log_filters' && typeof data.filters === 'object' && data.filters !== null) {
          socket.logFilters = {
            info: data.filters.info === true,
            warn: data.filters.warn === true,
            error: data.filters.error === true,
          };
        }
      } catch (e) {}
    });

    socket.on('close', () => {
      updateMonitoringSuppression();
    });

    socket.send(JSON.stringify({ type: 'status', ...(await sessionService.getStatus()) }));
  });

  const port = process.env.PORT || configService.get<number>('PORT') || 3000;
  await app.listen(port, '0.0.0.0');

  console.log(`✨ Trading Dashboard Backend running on port ${port}`);
  console.log(`📡 WebSocket endpoint: ws://0.0.0.0:${port}/session/ws`);
}

bootstrap().catch((err) => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
