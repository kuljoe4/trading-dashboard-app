import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebSocketServer } from 'ws';
import { AppModule } from './app.module';
import { SessionService } from './trading/session.service';

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

  // Enable CORS for frontend
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  });

  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port);

  const httpServer = app.getHttpServer();
  const sessionService = app.get(SessionService);
  const wss = new WebSocketServer({ server: httpServer, path: '/session/ws' });

  sessionService.setBroadcaster((data: unknown) => {
    const payload = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    });
  });

  wss.on('connection', async (socket) => {
    socket.send(JSON.stringify({ type: 'status', ...(await sessionService.getStatus()) }));
  });

  console.log(`✨ Trading Dashboard Backend running on http://localhost:${port}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${port}/session/ws`);
}

bootstrap().catch((err) => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
