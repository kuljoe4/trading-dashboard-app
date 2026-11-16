var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';
let BalanceHistory = class BalanceHistory {
    id;
    timestamp;
    balance;
    pnl;
    type; // e.g., 'TRADE_CLOSE', 'SESSION_STOP', 'RESET'
    sessionId;
    tradeId;
    tradingMode;
};
__decorate([
    PrimaryGeneratedColumn('uuid'),
    __metadata("design:type", String)
], BalanceHistory.prototype, "id", void 0);
__decorate([
    CreateDateColumn(),
    __metadata("design:type", Date)
], BalanceHistory.prototype, "timestamp", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8 }),
    __metadata("design:type", Number)
], BalanceHistory.prototype, "balance", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8, default: 0 }),
    __metadata("design:type", Number)
], BalanceHistory.prototype, "pnl", void 0);
__decorate([
    Column({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], BalanceHistory.prototype, "type", void 0);
__decorate([
    Column({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], BalanceHistory.prototype, "sessionId", void 0);
__decorate([
    Column({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], BalanceHistory.prototype, "tradeId", void 0);
__decorate([
    Column({ type: 'varchar', default: 'paper' }),
    __metadata("design:type", String)
], BalanceHistory.prototype, "tradingMode", void 0);
BalanceHistory = __decorate([
    Entity(),
    Index(['sessionId', 'timestamp'])
], BalanceHistory);
export { BalanceHistory };
