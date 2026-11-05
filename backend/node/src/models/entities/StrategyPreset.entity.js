var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
let StrategyPreset = class StrategyPreset {
    id;
    name;
    config;
    created_at;
    updated_at;
};
__decorate([
    PrimaryGeneratedColumn('uuid'),
    __metadata("design:type", String)
], StrategyPreset.prototype, "id", void 0);
__decorate([
    Index({ unique: true }),
    Column(),
    __metadata("design:type", String)
], StrategyPreset.prototype, "name", void 0);
__decorate([
    Column('jsonb'),
    __metadata("design:type", Object)
], StrategyPreset.prototype, "config", void 0);
__decorate([
    CreateDateColumn(),
    __metadata("design:type", Date)
], StrategyPreset.prototype, "created_at", void 0);
__decorate([
    UpdateDateColumn(),
    __metadata("design:type", Date)
], StrategyPreset.prototype, "updated_at", void 0);
StrategyPreset = __decorate([
    Entity()
], StrategyPreset);
export { StrategyPreset };
