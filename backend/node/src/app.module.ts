import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradingModule } from './trading/trading.module';
import { Session } from './models/entities/Session.entity';
import { TradeEntity } from './models/entities/Trade.entity';
import { Settings } from './models/entities/Settings.entity';
import { Log } from './models/entities/Log.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.get<string>('DATABASE_URL'),
        entities: [Session, TradeEntity, Settings, Log],
        synchronize: true, // Only for development/hobby plan, careful in production
        ssl: configService.get<string>('NODE_ENV') === 'production' ? { rejectUnauthorized: false } : false,
      }),
      inject: [ConfigService],
    }),
    TradingModule,
  ],
})
export class AppModule {}
