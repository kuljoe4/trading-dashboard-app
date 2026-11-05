var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Entity, Column, PrimaryColumn, Index } from 'typeorm';
let Kline = class Kline {
    id; // symbol_interval_time
    symbol;
    interval;
    time;
    open;
    high;
    low;
    close;
    volume;
};
__decorate([
    PrimaryColumn(),
    __metadata("design:type", String)
], Kline.prototype, "id", void 0);
__decorate([
    Column(),
    __metadata("design:type", String)
], Kline.prototype, "symbol", void 0);
__decorate([
    Column(),
    __metadata("design:type", String)
], Kline.prototype, "interval", void 0);
__decorate([
    Column({ type: 'bigint' }),
    __metadata("design:type", Number)
], Kline.prototype, "time", void 0);
__decorate([
    Column({ type: 'numeric', precision: 20, scale: 8 }),
    __metadata("design:type", Number)
], Kline.prototype, "open", void 0);
__decorate([
    Column({ type: 'numeric', precision: 20, scale: 8 }),
    __metadata("design:type", Number)
], Kline.prototype, "high", void 0);
__decorate([
    Column({ type: 'numeric', precision: 20, scale: 8 }),
    __metadata("design:type", Number)
], Kline.prototype, "low", void 0);
__decorate([
    Column({ type: 'numeric', precision: 20, scale: 8 }),
    __metadata("design:type", Number)
], Kline.prototype, "close", void 0);
__decorate([
    Column({ type: 'numeric', precision: 20, scale: 8 }),
    __metadata("design:type", Number)
], Kline.prototype, "volume", void 0);
Kline = __decorate([
    Entity('klines'),
    Index(['symbol', 'interval', 'time'], { unique: true })
], Kline);
export { Kline };
