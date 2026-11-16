var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Post, Get, Body, Patch, Delete, Param, ParseUUIDPipe, Query, BadRequestException, UseGuards, Req, Injectable, } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { SessionService } from "./session.service";
import { BacktestService, RunBacktestDto } from "../engine/backtest.service";
import { SmartOptimizerService, RunOptimizationDto } from "../engine/smart-optimizer.service";
import { ApiKeyGuard } from "../lib/api-key.guard";
import { SessionConfig } from "../models/SessionConfig";
import { StartSessionDto, UpdateSessionDto, UpdateTradeConfigDto, AdoptPositionDto, BackfillKlinesDto } from "./dto/session.dto";
import { PauseSessionDto } from "./dto/pause-session.dto";
import { extractIp } from "../lib/throttle";
import { formatValidationErrors } from "../lib/logger";
let LimitPipe = class LimitPipe {
    maxLimit;
    constructor(maxLimit = 1000) {
        this.maxLimit = maxLimit;
    }
    transform(value, metadata) {
        if (value === undefined || value === null || value === "")
            return undefined;
        // NestJS ValidationPipe with transform: true might convert query params to numbers BEFORE our custom pipe runs.
        const strValue = String(value);
        if (strValue.length > 10 || !/^\d+$/.test(strValue)) {
            throw new BadRequestException("Invalid limit format. Must be a positive integer.");
        }
        const parsed = parseInt(strValue, 10);
        if (isNaN(parsed) || parsed < 1 || parsed > this.maxLimit) {
            throw new BadRequestException(`Limit must be between 1 and ${this.maxLimit}`);
        }
        return parsed;
    }
};
LimitPipe = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [Number])
], LimitPipe);
export { LimitPipe };
let SessionIdPipe = class SessionIdPipe {
    transform(value, metadata) {
        if (value === undefined || value === null || value === "")
            return undefined;
        if (value === "all")
            return value;
        if (typeof value !== "string" || value.length > 50) {
            throw new BadRequestException("Invalid sessionId format");
        }
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
        if (!isUuid) {
            throw new BadRequestException("Invalid sessionId format");
        }
        return value;
    }
};
SessionIdPipe = __decorate([
    Injectable()
], SessionIdPipe);
export { SessionIdPipe };
let ModePipe = class ModePipe {
    transform(value, metadata) {
        const mode = value || "paper";
        if (typeof mode !== "string" || mode.length > 20 || !["paper", "testnet", "live"].includes(mode)) {
            throw new BadRequestException("Invalid mode. Must be one of: paper, testnet, live");
        }
        return mode;
    }
};
ModePipe = __decorate([
    Injectable()
], ModePipe);
export { ModePipe };
let SessionController = class SessionController {
    sessionService;
    backtestService;
    smartOptimizerService;
    constructor(sessionService, backtestService, smartOptimizerService) {
        this.sessionService = sessionService;
        this.backtestService = backtestService;
        this.smartOptimizerService = smartOptimizerService;
    }
    async backfillKlines(body) {
        const dto = plainToInstance(BackfillKlinesDto, body || {});
        const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
        if (errors.length > 0) {
            const detailedErrors = formatValidationErrors(errors);
            throw new BadRequestException({
                message: "Invalid backfill parameters",
                detail: detailedErrors,
            });
        }
        try {
            return await this.sessionService.forceBackfillKlines(dto.symbol, dto.interval);
        }
        catch (err) {
            throw new BadRequestException(err.message || "Failed to backfill candles");
        }
    }
    async runSmartOptimization(body) {
        // SEC-SENTINEL: Defense-in-depth validation of outer RunOptimizationDto payload
        const optDto = plainToInstance(RunOptimizationDto, body || {});
        const dtoErrors = await validate(optDto, { whitelist: true, forbidNonWhitelisted: true });
        if (dtoErrors.length > 0) {
            const detailedErrors = formatValidationErrors(dtoErrors);
            throw new BadRequestException({
                message: "Invalid smart optimizer parameters",
                detail: detailedErrors,
            });
        }
        const baseConfig = plainToInstance(SessionConfig, optDto.baseConfig || {});
        // SEC-SENTINEL: Defense-in-depth whitelist and type validation on strategy configuration instance
        const errors = await validate(baseConfig, { whitelist: true, forbidNonWhitelisted: true });
        if (errors.length > 0) {
            const detailedErrors = formatValidationErrors(errors);
            throw new BadRequestException({
                message: "Invalid base strategy configuration in smart optimizer",
                detail: detailedErrors,
            });
        }
        return this.smartOptimizerService.runOptimization({
            ...optDto,
            baseConfig,
        });
    }
    async getSmartRecommendations() {
        return {
            recommendations: this.smartOptimizerService.getTopRecommendations(),
        };
    }
    async clearSmartRecommendations() {
        this.smartOptimizerService.clearRecommendations();
        return { success: true };
    }
    async clearBan() {
        this.sessionService.clearBan();
        return { success: true };
    }
    async runBacktest(body) {
        // SEC-SENTINEL: Defense-in-depth validation of outer RunBacktestDto payload
        const backtestDto = plainToInstance(RunBacktestDto, body || {});
        const dtoErrors = await validate(backtestDto, { whitelist: true, forbidNonWhitelisted: true });
        if (dtoErrors.length > 0) {
            const detailedErrors = formatValidationErrors(dtoErrors);
            throw new BadRequestException({
                message: "Invalid backtest parameters",
                detail: detailedErrors,
            });
        }
        const config = plainToInstance(SessionConfig, backtestDto.config || {});
        // SEC-SENTINEL: Defense-in-depth whitelist and type validation on strategy configuration instance
        const errors = await validate(config, { whitelist: true, forbidNonWhitelisted: true });
        if (errors.length > 0) {
            const detailedErrors = formatValidationErrors(errors);
            throw new BadRequestException({
                message: "Invalid strategy configuration in backtest",
                detail: detailedErrors,
            });
        }
        return this.backtestService.runBacktest({
            ...backtestDto,
            config,
        });
    }
    async startSession(body, req) {
        // SEC-SENTINEL: Defense-in-depth validation of outer StartSessionDto payload
        const startDto = plainToInstance(StartSessionDto, body || {});
        const dtoErrors = await validate(startDto, { whitelist: true, forbidNonWhitelisted: true });
        if (dtoErrors.length > 0) {
            const detailedErrors = formatValidationErrors(dtoErrors);
            throw new BadRequestException({
                message: "Invalid start session parameters",
                detail: detailedErrors,
            });
        }
        const clientIp = req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
        const userAgent = req.headers["user-agent"];
        const config = plainToInstance(SessionConfig, startDto.config || {});
        // SEC-SENTINEL: Defense-in-depth whitelist and type validation on strategy configuration instance
        const errors = await validate(config, { whitelist: true, forbidNonWhitelisted: true });
        if (errors.length > 0) {
            const detailedErrors = formatValidationErrors(errors);
            throw new BadRequestException({
                message: "Invalid strategy configuration",
                detail: detailedErrors,
            });
        }
        return this.sessionService.startSession(config, startDto.paper_mode ?? true, startDto.sessionId, clientIp, userAgent);
    }
    async listSessions() {
        return this.sessionService.listSessions();
    }
    async stopSession(req) {
        const clientIp = req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
        const userAgent = req.headers["user-agent"];
        return this.sessionService.stopSession(clientIp, userAgent);
    }
    async updateSession(id, body, req) {
        // SEC-SENTINEL: Defense-in-depth validation of UpdateSessionDto outer payload
        const sessionDto = plainToInstance(UpdateSessionDto, body || {});
        const dtoErrors = await validate(sessionDto, { whitelist: true, forbidNonWhitelisted: true });
        if (dtoErrors.length > 0) {
            const detailedErrors = formatValidationErrors(dtoErrors);
            throw new BadRequestException({
                message: "Invalid update session parameters",
                detail: detailedErrors,
            });
        }
        const clientIp = req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
        const userAgent = req.headers["user-agent"];
        const configInstance = plainToInstance(SessionConfig, sessionDto.config || {});
        // SEC-SENTINEL: Defense-in-depth whitelist and type validation on partial session configuration instance
        const errors = await validate(configInstance, { whitelist: true, forbidNonWhitelisted: true, skipMissingProperties: true });
        if (errors.length > 0) {
            const detailedErrors = formatValidationErrors(errors);
            throw new BadRequestException({
                message: "Invalid configuration parameters in update session",
                detail: detailedErrors,
            });
        }
        return this.sessionService.updateSession(id, configInstance, clientIp, userAgent);
    }
    async pauseSession(body, req) {
        // SEC-SENTINEL: Defense-in-depth validation of PauseSessionDto payload
        const pauseDto = plainToInstance(PauseSessionDto, body || {});
        const dtoErrors = await validate(pauseDto, { whitelist: true, forbidNonWhitelisted: true });
        if (dtoErrors.length > 0) {
            const detailedErrors = formatValidationErrors(dtoErrors);
            throw new BadRequestException({
                message: "Invalid pause session parameters",
                detail: detailedErrors,
            });
        }
        const clientIp = req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
        const userAgent = req.headers["user-agent"];
        return this.sessionService.pauseSession(pauseDto.paused, pauseDto.strategyLabel, clientIp, userAgent);
    }
    async deleteOrphanedTrades(req) {
        const clientIp = req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
        const userAgent = req.headers["user-agent"];
        return this.sessionService.deleteOrphanedTrades(clientIp, userAgent);
    }
    async deleteSession(id, req) {
        const clientIp = req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
        const userAgent = req.headers["user-agent"];
        return this.sessionService.deleteSession(id, clientIp, userAgent);
    }
    async getUntrackedPositions() {
        return this.sessionService.getUntrackedPositions();
    }
    async adoptPosition(body, req) {
        // SEC-SENTINEL: Defense-in-depth validation of AdoptPositionDto payload
        const adoptDto = plainToInstance(AdoptPositionDto, body || {});
        const dtoErrors = await validate(adoptDto, { whitelist: true, forbidNonWhitelisted: true });
        if (dtoErrors.length > 0) {
            const detailedErrors = formatValidationErrors(dtoErrors);
            throw new BadRequestException({
                message: "Invalid adopt position parameters",
                detail: detailedErrors,
            });
        }
        const clientIp = req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
        const userAgent = req.headers["user-agent"];
        return this.sessionService.adoptPositionManually(adoptDto.symbol, adoptDto.strategyLabel, adoptDto.initialSl, adoptDto.currentSl, clientIp, userAgent);
    }
    async getStatus() {
        return this.sessionService.getStatus(false);
    }
    async getLogs(limit) {
        return this.sessionService.getLogs(limit ?? 50);
    }
    async getTrade(id) {
        // SENTINEL: Input validation to ensure 'id' is a valid UUID or Binance symbol format.
        // Prevents potential probing attacks or malformed input issues.
        // SENTINEL: Enforce explicit string type assertion and maximum length constraint before any regex evaluation to prevent ReDoS/CPU abuse and HPP type confusion.
        if (!id || typeof id !== "string" || id.length > 50) {
            throw new BadRequestException("Invalid trade ID or symbol format");
        }
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        const isSymbol = /^[A-Z0-9]{3,20}$/.test(id);
        if (!isUuid && !isSymbol) {
            throw new BadRequestException("Invalid trade ID or symbol format");
        }
        return this.sessionService.getTrade(id);
    }
    async updateTradeConfig(id, body, req) {
        // SENTINEL: Enforce explicit string type assertion and maximum length constraint before any regex evaluation to prevent ReDoS/CPU abuse and HPP type confusion.
        if (!id || typeof id !== "string" || id.length > 50) {
            throw new BadRequestException("Invalid trade ID or symbol format");
        }
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        const isSymbol = /^[A-Z0-9]{3,20}$/.test(id);
        if (!isUuid && !isSymbol) {
            throw new BadRequestException("Invalid trade ID or symbol format");
        }
        // SEC-SENTINEL: Defense-in-depth validation of UpdateTradeConfigDto outer payload
        const tradeConfigDto = plainToInstance(UpdateTradeConfigDto, body || {});
        const dtoErrors = await validate(tradeConfigDto, { whitelist: true, forbidNonWhitelisted: true });
        if (dtoErrors.length > 0) {
            const detailedErrors = formatValidationErrors(dtoErrors);
            throw new BadRequestException({
                message: "Invalid update trade config parameters",
                detail: detailedErrors,
            });
        }
        if (tradeConfigDto.strategy_config) {
            const configInstance = plainToInstance(SessionConfig, tradeConfigDto.strategy_config);
            // SEC-SENTINEL: Defense-in-depth whitelist and type validation on trade strategy configuration overrides
            const errors = await validate(configInstance, { whitelist: true, forbidNonWhitelisted: true, skipMissingProperties: true });
            if (errors.length > 0) {
                const detailedErrors = formatValidationErrors(errors);
                throw new BadRequestException({
                    message: "Invalid strategy_config parameters in update trade config",
                    detail: detailedErrors,
                });
            }
        }
        const clientIp = req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
        const userAgent = req.headers["user-agent"];
        return this.sessionService.updateTradeConfig(id, tradeConfigDto, clientIp, userAgent);
    }
    async getBinanceRateLimit() {
        return this.sessionService.getBinanceRateLimit();
    }
    async getHistory(sessionId, limit) {
        return this.sessionService.getHistory(sessionId, limit);
    }
    async closeTradeManually(symbol, req) {
        // Basic input hardening: ensure symbol matches expected Binance format
        // SENTINEL: Enforce explicit string type assertion and maximum length constraint before any regex evaluation to prevent ReDoS/CPU abuse and HPP type confusion.
        if (!symbol || typeof symbol !== "string" || symbol.length > 50 || !/^[A-Z0-9]{3,20}$/.test(symbol)) {
            throw new BadRequestException("Invalid symbol format");
        }
        const clientIp = req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
        const userAgent = req.headers["user-agent"];
        return this.sessionService.closeTradeManually(symbol, clientIp, userAgent);
    }
    async getAnalytics() {
        return this.sessionService.getAnalytics();
    }
    async getLifetimeAnalytics(mode) {
        return this.sessionService.getLifetimeAnalytics(mode);
    }
    async resetPaperBalance(req) {
        const clientIp = req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
        const userAgent = req.headers["user-agent"];
        return this.sessionService.resetPaperBalance(clientIp, userAgent);
    }
};
__decorate([
    Post("backfill-klines"),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [BackfillKlinesDto]),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "backfillKlines", null);
__decorate([
    Post("smart-optimizer/run"),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [RunOptimizationDto]),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "runSmartOptimization", null);
__decorate([
    Get("smart-optimizer/recommendations"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "getSmartRecommendations", null);
__decorate([
    Delete("smart-optimizer/recommendations"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "clearSmartRecommendations", null);
__decorate([
    Post("clear-ban"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "clearBan", null);
__decorate([
    Post("backtest"),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [RunBacktestDto]),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "runBacktest", null);
__decorate([
    Post("start"),
    __param(0, Body()),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [StartSessionDto, Object]),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "startSession", null);
__decorate([
    Get("list"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "listSessions", null);
__decorate([
    Post("stop"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "stopSession", null);
__decorate([
    Patch(":id"),
    __param(0, Param("id", ParseUUIDPipe)),
    __param(1, Body()),
    __param(2, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, UpdateSessionDto, Object]),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "updateSession", null);
__decorate([
    Post("pause"),
    __param(0, Body()),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [PauseSessionDto, Object]),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "pauseSession", null);
__decorate([
    Delete("trades/orphans"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "deleteOrphanedTrades", null);
__decorate([
    Delete(":id"),
    __param(0, Param("id", ParseUUIDPipe)),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "deleteSession", null);
__decorate([
    Get("untracked-positions"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "getUntrackedPositions", null);
__decorate([
    Post("adopt-position"),
    __param(0, Body()),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [AdoptPositionDto, Object]),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "adoptPosition", null);
__decorate([
    Get("status"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "getStatus", null);
__decorate([
    Get("logs"),
    __param(0, Query("limit", new LimitPipe(1000))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "getLogs", null);
__decorate([
    Get("trade/:id"),
    __param(0, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "getTrade", null);
__decorate([
    Patch("trade/:id/config"),
    __param(0, Param("id")),
    __param(1, Body()),
    __param(2, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, UpdateTradeConfigDto, Object]),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "updateTradeConfig", null);
__decorate([
    Get("binance/rate-limit"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "getBinanceRateLimit", null);
__decorate([
    Get("history"),
    __param(0, Query("sessionId", new SessionIdPipe())),
    __param(1, Query("limit", new LimitPipe(5000))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Number]),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "getHistory", null);
__decorate([
    Post("trade/:symbol/close"),
    __param(0, Param("symbol")),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "closeTradeManually", null);
__decorate([
    Get("analytics"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "getAnalytics", null);
__decorate([
    Get("lifetime-analytics"),
    __param(0, Query("mode", new ModePipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "getLifetimeAnalytics", null);
__decorate([
    Post("reset-paper-balance"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "resetPaperBalance", null);
SessionController = __decorate([
    Controller("session"),
    UseGuards(ApiKeyGuard),
    __metadata("design:paramtypes", [SessionService,
        BacktestService,
        SmartOptimizerService])
], SessionController);
export { SessionController };
