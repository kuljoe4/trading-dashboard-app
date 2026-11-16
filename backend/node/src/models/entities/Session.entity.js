var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, OneToMany } from 'typeorm';
import { TradeEntity } from './Trade.entity';
let Session = class Session {
    id;
    running;
    paperMode;
    tradingMode;
    balance;
    totalPnl;
    strategyLabel;
    startTime;
    endTime;
    config;
    trades;
};
__decorate([
    PrimaryGeneratedColumn('uuid'),
    __metadata("design:type", String)
], Session.prototype, "id", void 0);
__decorate([
    Column({ default: true }),
    __metadata("design:type", Boolean)
], Session.prototype, "running", void 0);
__decorate([
    Column({ default: true }),
    __metadata("design:type", Boolean)
], Session.prototype, "paperMode", void 0);
__decorate([
    Column({ type: 'varchar', default: 'paper' }),
    __metadata("design:type", String)
], Session.prototype, "tradingMode", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8, default: 0 }),
    __metadata("design:type", Number)
], Session.prototype, "balance", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8, default: 0 }),
    __metadata("design:type", Number)
], Session.prototype, "totalPnl", void 0);
__decorate([
    Column({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], Session.prototype, "strategyLabel", void 0);
__decorate([
    CreateDateColumn(),
    __metadata("design:type", Date)
], Session.prototype, "startTime", void 0);
__decorate([
    Column({ type: 'timestamp', nullable: true }),
    __metadata("design:type", Object)
], Session.prototype, "endTime", void 0);
__decorate([
    Column('jsonb', { nullable: true }),
    __metadata("design:type", Object)
], Session.prototype, "config", void 0);
__decorate([
    OneToMany(() => TradeEntity, (trade) => trade.session),
    __metadata("design:type", Array)
], Session.prototype, "trades", void 0);
Session = __decorate([
    Entity()
], Session);
export { Session };
