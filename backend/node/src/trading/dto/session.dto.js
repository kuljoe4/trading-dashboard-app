var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { IsOptional, IsBoolean, IsString, ValidateNested, IsUUID, IsNotEmpty, IsObject, IsArray, IsNumber, ArrayMaxSize, MaxLength, Matches, Min, Max, } from "class-validator";
import { Type } from "class-transformer";
import { SessionConfig } from "../../models/SessionConfig";
export class StartSessionDto {
    config;
    paper_mode;
    sessionId;
}
__decorate([
    IsOptional(),
    IsObject(),
    ValidateNested(),
    Type(() => SessionConfig),
    __metadata("design:type", SessionConfig)
], StartSessionDto.prototype, "config", void 0);
__decorate([
    IsOptional(),
    IsBoolean(),
    __metadata("design:type", Boolean)
], StartSessionDto.prototype, "paper_mode", void 0);
__decorate([
    IsOptional(),
    IsString(),
    IsNotEmpty(),
    IsUUID(),
    __metadata("design:type", String)
], StartSessionDto.prototype, "sessionId", void 0);
export class PauseSessionDto {
    paused;
}
__decorate([
    IsBoolean(),
    IsNotEmpty(),
    __metadata("design:type", Boolean)
], PauseSessionDto.prototype, "paused", void 0);
export class UpdateSessionDto {
    config;
}
__decorate([
    IsObject(),
    IsNotEmpty(),
    ValidateNested(),
    Type(() => SessionConfig),
    __metadata("design:type", SessionConfig)
], UpdateSessionDto.prototype, "config", void 0);
export class AdoptPositionDto {
    symbol;
    strategyLabel;
    initialSl;
    currentSl;
}
__decorate([
    IsString(),
    IsNotEmpty(),
    MaxLength(20, { message: "Symbol cannot exceed 20 characters" }),
    Matches(/^[A-Z0-9]{3,20}$/, {
        message: "Symbol must be a valid uppercase alphanumeric string between 3 and 20 characters",
    }),
    __metadata("design:type", String)
], AdoptPositionDto.prototype, "symbol", void 0);
__decorate([
    IsString(),
    IsNotEmpty(),
    MaxLength(100, { message: "Strategy label cannot exceed 100 characters" }),
    Matches(/^[a-zA-Z0-9_\s.\-()><=%+,\[\]]*$/, {
        message: "Strategy label can only contain alphanumeric characters, spaces, underscores, dots, hyphens, and safe descriptive characters like (), ><=, %, +, ,, and []",
    }),
    Matches(/^(?!.*<[a-zA-Z!/]).*$/, {
        message: "Strategy label cannot contain HTML tags or tag-like structures",
    }),
    __metadata("design:type", String)
], AdoptPositionDto.prototype, "strategyLabel", void 0);
__decorate([
    IsOptional(),
    IsNumber(),
    Min(0.000001, { message: "Initial SL must be a positive number" }),
    Max(100000000, { message: "Initial SL cannot exceed 100,000,000" }),
    __metadata("design:type", Number)
], AdoptPositionDto.prototype, "initialSl", void 0);
__decorate([
    IsOptional(),
    IsNumber(),
    Min(0.000001, { message: "Current SL must be a positive number" }),
    Max(100000000, { message: "Current SL cannot exceed 100,000,000" }),
    __metadata("design:type", Number)
], AdoptPositionDto.prototype, "currentSl", void 0);
export class BackfillKlinesDto {
    symbol;
    interval;
}
__decorate([
    IsString(),
    IsNotEmpty(),
    MaxLength(20, { message: "Symbol cannot exceed 20 characters" }),
    Matches(/^[A-Z0-9]{3,20}$/, {
        message: "Symbol must be a valid uppercase alphanumeric string between 3 and 20 characters",
    }),
    __metadata("design:type", String)
], BackfillKlinesDto.prototype, "symbol", void 0);
__decorate([
    IsString(),
    IsNotEmpty(),
    MaxLength(10, { message: "Interval cannot exceed 10 characters" }),
    Matches(/^(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)$/, {
        message: "Interval must be a valid candlestick timeframe (e.g. 1m, 5m, 1h, 4h, 1d)",
    }),
    __metadata("design:type", String)
], BackfillKlinesDto.prototype, "interval", void 0);
export class UpdateTradeConfigDto {
    current_sl;
    live_rr_sequence;
    exit_rr_sequence;
    strategy_config;
}
__decorate([
    IsOptional(),
    IsNumber(),
    Min(0.000001, { message: "Stop loss must be a positive number" }),
    Max(100000000, { message: "Current SL cannot exceed 100,000,000" }),
    __metadata("design:type", Number)
], UpdateTradeConfigDto.prototype, "current_sl", void 0);
__decorate([
    IsOptional(),
    IsArray(),
    IsNumber({}, { each: true }),
    Min(0, { each: true, message: "live_rr_sequence elements must be non-negative" }),
    Max(100, { each: true, message: "live_rr_sequence elements cannot exceed 100" }),
    ArrayMaxSize(10, { message: "live_rr_sequence cannot exceed 10 elements" }),
    __metadata("design:type", Array)
], UpdateTradeConfigDto.prototype, "live_rr_sequence", void 0);
__decorate([
    IsOptional(),
    IsArray(),
    IsNumber({}, { each: true }),
    Min(0, { each: true, message: "exit_rr_sequence elements must be non-negative" }),
    Max(100, { each: true, message: "exit_rr_sequence elements cannot exceed 100" }),
    ArrayMaxSize(10, { message: "exit_rr_sequence cannot exceed 10 elements" }),
    __metadata("design:type", Array)
], UpdateTradeConfigDto.prototype, "exit_rr_sequence", void 0);
__decorate([
    IsOptional(),
    IsObject(),
    ValidateNested(),
    Type(() => SessionConfig),
    __metadata("design:type", SessionConfig)
], UpdateTradeConfigDto.prototype, "strategy_config", void 0);
