import { SHARED_MARKET_DATA, SharedMarketData } from './engine/shared-market-data';
import { ENGINE_MODE, getEngineDatabaseUrl, getEngineMode } from './lib/engine-mode';
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TradingModule } from './trading/trading.module';
import { AuthModule } from './auth/auth.module';

const config = ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' });

@Module({})
class EngineContextModule {}

@Module({})
export class AppModule {
  static register(mode = getEngineMode(), marketData?: SharedMarketData): DynamicModule {
    const context: DynamicModule = {
      module: EngineContextModule,
      global: true,
      providers: [
        { provide: ENGINE_MODE, useValue: mode ?? null },
        { provide: SHARED_MARKET_DATA, useValue: marketData ?? null },
      ],
      exports: [ENGINE_MODE, SHARED_MARKET_DATA],
    };
    return {
      module: AppModule,
      imports: [
        context,
        config,
        TypeOrmModule.forRootAsync({
          imports: [ConfigModule],
          useFactory: (configService: ConfigService) => ({
            type: 'postgres',
            url: getEngineDatabaseUrl(
              mode,
              configService.get<string>('DATABASE_URL'),
              configService.get<string>('PAPER_DATABASE_URL'),
            ),
            autoLoadEntities: true,
            entities: [],
            synchronize: false, // Explicitly disable synchronize in all environments
            logging: false,
            // PERFORMANCE: Optimize PostgreSQL for trading workloads (Reduce connection pool memory overhead)
            extra: {
              max: 3,
              idleTimeoutMillis: 30000,
              connectionTimeoutMillis: 2000,
              // SRE: Optimize checkpoint behavior to protect the Node.js event loop from I/O stalls.
              // Note: These usually require superuser or postgresql.conf, but passing via connection parameters
              // where supported or documenting the requirement.
              statement_timeout: 10000,
              // Enable TCP keepalive probes to prevent abrupt SSL EOF resets on idle pool connections
              keepalives: true,
              keepalives_idle: 10,
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
    };
  }
}
