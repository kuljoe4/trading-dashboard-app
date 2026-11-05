var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TradingModule } from './trading/trading.module';
import { AuthModule } from './auth/auth.module';
let AppModule = class AppModule {
};
AppModule = __decorate([
    Module({
        imports: [
            ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: '.env',
            }),
            TypeOrmModule.forRootAsync({
                imports: [ConfigModule],
                useFactory: (configService) => ({
                    type: 'postgres',
                    url: configService.get('DATABASE_URL'),
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
                    ssl: configService.get('NODE_ENV') === 'production' ? { rejectUnauthorized: false } : false,
                }),
                inject: [ConfigService],
            }),
            EventEmitterModule.forRoot(),
            TradingModule,
            AuthModule,
        ],
    })
], AppModule);
export { AppModule };
