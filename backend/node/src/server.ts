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

  // Security Headers Middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; object-src 'none';");
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // Enable CORS for frontend
  app.enableCors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
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
  const wss = new WebSocketServer({ server: httpServer, path: '/session/ws' });

  const updateMonitoringSuppression = () => {
    const anyActive = Array.from(wss.clients).some((c: any) => c.monitoringEnabled !== false);
    monitoringService.setEnabled(anyActive);
  };

  sessionService.setBroadcaster((data: any) => {
    const basePayload = typeof data === 'string' ? JSON.parse(data) : data;
    
    wss.clients.forEach((client: any) => {
      if (client.readyState === client.OPEN) {
        // Suppress monitoring data if client has it disabled
        if (basePayload.type === 'tick' && client.monitoringEnabled === false) {
          const stripped = { ...basePayload };
          delete stripped.monitoring;
          client.send(JSON.stringify(stripped));
        } else {
          client.send(JSON.stringify(basePayload));
        }
      }
    });
  });

  wss.on('connection', async (socket: any) => {
    socket.monitoringEnabled = true; // Default to enabled
    updateMonitoringSuppression();
    
    socket.on('message', (message: string) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'set_monitoring') {
          socket.monitoringEnabled = data.enabled;
          console.log(`Client monitoring preference updated: ${data.enabled}`);
          updateMonitoringSuppression();
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
