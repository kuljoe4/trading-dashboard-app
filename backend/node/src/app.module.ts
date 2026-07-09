import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TradingModule } from './trading/trading.module';
import { AuthModule } from './auth/auth.module';
import { Session } from './models/entities/Session.entity';
import { TradeEntity } from './models/entities/Trade.entity';
import { Settings } from './models/entities/Settings.entity';
import { Log } from './models/entities/Log.entity';
import { AuditLog } from './models/entities/AuditLog.entity';
import { BalanceHistory } from './models/entities/BalanceHistory.entity';
import { StrategyPreset } from './models/entities/StrategyPreset.entity';
import { Kline } from './models/entities/Kline.entity';
import { User, UserProfile } from './models/entities/User.entity';
import { Follow } from './models/entities/Follow.entity';

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
        entities: [Session, TradeEntity, Settings, Log, AuditLog, BalanceHistory, StrategyPreset, Kline, User, UserProfile, Follow],
        synchronize: false, // Explicitly disable synchronize in all environments
        // PERFORMANCE: Optimize PostgreSQL for trading workloads (Reduce checkpoint spikes)
        extra: {
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 2000,
          // SRE: Optimize checkpoint behavior to protect the Node.js event loop from I/O stalls.
          // Note: These usually require superuser or postgresql.conf, but passing via connection parameters
          // where supported or documenting the requirement.
          statement_timeout: 10000,
        },
        migrations: [__dirname + '/migrations/*.{ts,js}'],
        migrationsRun: true,
        ssl: configService.get<string>('NODE_ENV') === 'production' ? { rejectUnauthorized: false } : false,
      }),
      inject: [ConfigService],
    }),
    EventEmitterModule.forRoot(),
    TradingModule,
    AuthModule,
  ],
})
export class AppModule {}
