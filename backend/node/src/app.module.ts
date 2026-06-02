import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TradingModule } from './trading/trading.module';
import { Session } from './models/entities/Session.entity';
import { TradeEntity } from './models/entities/Trade.entity';
import { Settings } from './models/entities/Settings.entity';
import { Log } from './models/entities/Log.entity';
import { BalanceHistory } from './models/entities/BalanceHistory.entity';

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
        entities: [Session, TradeEntity, Settings, Log, BalanceHistory],
        synchronize: false, // Explicitly disable synchronize in all environments
        migrations: [__dirname + '/migrations/**/*{.ts,.js}'],
        migrationsRun: true,
        ssl: configService.get<string>('NODE_ENV') === 'production' ? { rejectUnauthorized: false } : false,
      }),
      inject: [ConfigService],
    }),
    EventEmitterModule.forRoot(),
    TradingModule,
  ],
})
export class AppModule {}
