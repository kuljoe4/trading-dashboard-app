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
    'https://frontend-production-9bcd.up.railway.app', // Adding your specific frontend domain
  ];

  console.log(`🔒 Allowed Origins: ${allowedOrigins.join(', ')}`);

  // Enable CORS for frontend
  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.indexOf(origin) !== -1 || nodeEnv !== 'production') {
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

  const port = process.env.PORT || configService.get<number>('PORT') || 3000;
  await app.listen(port, '0.0.0.0');

  const httpServer = app.getHttpServer();
  console.log(`✨ Trading Dashboard Backend running on port ${port}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${port}/session/ws`);
}

bootstrap().catch((err) => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
