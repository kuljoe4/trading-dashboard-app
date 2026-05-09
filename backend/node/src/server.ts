import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';
import { ConfigModule } from '@nestjs/config';
import { WebSocketGateway, SubscribeMessage } from '@nestjs/websockets';
import { Server } from 'ws';
import { join } from 'path';
import { TradingModule } from './trading/trading.module';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot(),
    GraphQLModule.forRoot({
      driver: ApolloDriver,
      autoSchemaFile: true,
    }),
    TradingModule,
  ],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  
  // Get Binance API keys from config
  const apiKey = configService.get('BINANCE_API_KEY');
  const apiSecret = configService.get('BINANCE_SECRET_KEY');
  
  // Initialize Binance client if keys exist
  if (apiKey && apiSecret) {
    // This would be where we initialize the actual Binance client
    // For now, we'll just log that keys are loaded
    console.log('Binance API keys loaded');
  }
  
  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port);
  console.log(`🚀 Application ready at http://localhost:${port}/graphql`);
}
bootstrap();