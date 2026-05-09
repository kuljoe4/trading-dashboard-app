import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TradingModule } from './trading/trading.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TradingModule,
  ],
})
export class AppModule {}
