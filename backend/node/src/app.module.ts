import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TradingModule } from './trading/trading.module';
import { AuthModule } from './auth/auth.module';

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
        autoLoadEntities: true,
        entities: [],
        synchronize: false, // Explicitly disable synchronize in all environments
        // PERFORMANCE: Optimize PostgreSQL for trading workloads (Reduce connection pool memory overhead)
        extra: {
          max: 5,
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
