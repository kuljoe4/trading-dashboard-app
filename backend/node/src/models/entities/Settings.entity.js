var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Entity, Column, PrimaryColumn } from 'typeorm';
let Settings = class Settings {
    id;
    binance_api_key;
    binance_api_secret;
    binance_testnet_api_key;
    binance_testnet_api_secret;
    paper_balance;
    testnet_balance;
    live_balance;
    exchange_info_cache;
    exchange_info_ts;
    taker_fee_rate;
    taker_fee_ts;
    proxy_url;
    is_one_way_mode;
    last_mode_sync;
    exchange_rate_limit;
};
__decorate([
    PrimaryColumn({ default: 'default' }),
    __metadata("design:type", String)
], Settings.prototype, "id", void 0);
__decorate([
    Column({ type: 'varchar', nullable: true, select: false }),
    __metadata("design:type", Object)
], Settings.prototype, "binance_api_key", void 0);
__decorate([
    Column({ type: 'varchar', nullable: true, select: false }),
    __metadata("design:type", Object)
], Settings.prototype, "binance_api_secret", void 0);
__decorate([
    Column({ type: 'varchar', nullable: true, select: false }),
    __metadata("design:type", Object)
], Settings.prototype, "binance_testnet_api_key", void 0);
__decorate([
    Column({ type: 'varchar', nullable: true, select: false }),
    __metadata("design:type", Object)
], Settings.prototype, "binance_testnet_api_secret", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8, default: 10000.0 }),
    __metadata("design:type", Number)
], Settings.prototype, "paper_balance", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8, default: 0 }),
    __metadata("design:type", Number)
], Settings.prototype, "testnet_balance", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8, default: 0 }),
    __metadata("design:type", Number)
], Settings.prototype, "live_balance", void 0);
__decorate([
    Column({ type: 'jsonb', nullable: true, select: false }),
    __metadata("design:type", Object)
], Settings.prototype, "exchange_info_cache", void 0);
__decorate([
    Column({ type: 'bigint', nullable: true }),
    __metadata("design:type", Number)
], Settings.prototype, "exchange_info_ts", void 0);
__decorate([
    Column('decimal', { precision: 10, scale: 8, default: 0.0004 }),
    __metadata("design:type", Number)
], Settings.prototype, "taker_fee_rate", void 0);
__decorate([
    Column({ type: 'bigint', nullable: true }),
    __metadata("design:type", Number)
], Settings.prototype, "taker_fee_ts", void 0);
__decorate([
    Column({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], Settings.prototype, "proxy_url", void 0);
__decorate([
    Column({ type: 'boolean', nullable: true }),
    __metadata("design:type", Boolean)
], Settings.prototype, "is_one_way_mode", void 0);
__decorate([
    Column({ type: 'bigint', nullable: true }),
    __metadata("design:type", Number)
], Settings.prototype, "last_mode_sync", void 0);
__decorate([
    Column({ type: 'integer', nullable: true }),
    __metadata("design:type", Number)
], Settings.prototype, "exchange_rate_limit", void 0);
Settings = __decorate([
    Entity()
], Settings);
export { Settings };
