import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import { WebSocketServer } from 'ws';
import { AppModule } from './app.module';
import { SessionService } from './trading/session.service';
import { MonitoringService } from './engine/monitoring.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
  ];

  const nodeEnv = configService.get<string>('NODE_ENV');

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
    origin: allowedOrigins,
    credentials: true,
  });

  // Health check endpoint
  app.getHttpAdapter().get('/health', (req, res) => {
    res.status(200).send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port);

  const httpServer = app.getHttpServer();
  const sessionService = app.get(SessionService);
  const monitoringService = app.get(MonitoringService);
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/session/ws',
    verifyClient: (info, done) => {
      const origin = info.origin;
      const isAllowed = allowedOrigins.includes(origin);
      if (!isAllowed) {
        console.warn(`Blocked WebSocket connection from unauthorized origin: ${origin}`);
      }
      done(isAllowed);
    },
  });

  const updateMonitoringSuppression = () => {
    const anyActive = Array.from(wss.clients).some((c: any) => c.monitoringEnabled !== false);
    monitoringService.setEnabled(anyActive);
  };

  sessionService.setBroadcaster((data: any) => {
    const basePayload = typeof data === 'string' ? JSON.parse(data) : data;
    
    wss.clients.forEach((client: any) => {
      if (client.readyState !== client.OPEN) return;

      // Focus Mode: Suppress scanner updates to save bandwidth/CPU when user is in Detail View
      if (basePayload.type === 'scanner' && client.focusMode === true) {
        return;
      }

      // Suppress monitoring data if client has it disabled
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
    socket.monitoringEnabled = true; // Default to enabled
    socket.focusMode = false; // Default to disabled
    socket.logFilters = { info: true, warn: true, error: true };
    updateMonitoringSuppression();
    
    socket.on('message', (message: string) => {
      try {
        // Limit message size to prevent DoS via large JSON payloads
        if (message.length > 1000) return;

        const data = JSON.parse(message);
        if (data.type === 'set_monitoring') {
          // Strict boolean check for security
          socket.monitoringEnabled = data.enabled === true;
          console.log(`Client monitoring preference updated: ${socket.monitoringEnabled}`);
          updateMonitoringSuppression();
        }

        if (data.type === 'set_focus_mode') {
          socket.focusMode = data.enabled === true;
          console.log(`Client focus mode updated: ${socket.focusMode}`);
        }

        if (data.type === 'set_log_filters' && typeof data.filters === 'object' && data.filters !== null) {
          socket.logFilters = {
            info: data.filters.info === true,
            warn: data.filters.warn === true,
            error: data.filters.error === true,
          };
          console.log(`Client log filter preferences updated: ${JSON.stringify(socket.logFilters)}`);
        }
      } catch (e) {}
    });

    socket.on('close', () => {
      updateMonitoringSuppression();
    });

    socket.send(JSON.stringify({ type: 'status', ...(await sessionService.getStatus()) }));
  });

  console.log(`✨ Trading Dashboard Backend running on http://localhost:${port}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${port}/session/ws`);
}

bootstrap().catch((err) => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
