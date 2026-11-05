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
var PresetsController_1;
import { Controller, Get, Post, Delete, Body, Param, UseGuards, Req, Logger, NotFoundException, BadRequestException, } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { StrategyPreset } from "../models/entities/StrategyPreset.entity";
import { CreateStrategyPresetDto, } from "./dto/strategy-preset.dto";
import { SessionConfig } from "../models/SessionConfig";
import { ApiKeyGuard } from "../lib/api-key.guard";
import { AuditLogService } from "./audit-log.service";
import { extractIp } from "../lib/throttle";
import { formatValidationErrors } from "../lib/logger";
let PresetsController = PresetsController_1 = class PresetsController {
    presetRepository;
    auditLog;
    logger = new Logger(PresetsController_1.name);
    constructor(presetRepository, auditLog) {
        this.presetRepository = presetRepository;
        this.auditLog = auditLog;
    }
    async listPresets() {
        return this.presetRepository.find({
            order: { name: "ASC" },
        });
    }
    async savePreset(body, req) {
        const clientIp = req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
        // SEC-SENTINEL: Defense-in-depth validation of the outer preset DTO and strategy configuration
        // SENTINEL: Enforce whitelist and forbidNonWhitelisted to prevent arbitrary parameter injection/pollution in preset configuration
        const presetDto = plainToInstance(CreateStrategyPresetDto, body || {});
        const dtoErrors = await validate(presetDto, { whitelist: true, forbidNonWhitelisted: true });
        if (dtoErrors.length > 0) {
            const detailedErrors = formatValidationErrors(dtoErrors);
            this.logger.warn(`Preset DTO validation failed: ${JSON.stringify(detailedErrors)}`);
            throw new BadRequestException({
                message: "Invalid strategy preset parameters",
                detail: detailedErrors,
            });
        }
        const configInstance = plainToInstance(SessionConfig, presetDto.config || {});
        const errors = await validate(configInstance, { whitelist: true, forbidNonWhitelisted: true });
        if (errors.length > 0) {
            const detailedErrors = formatValidationErrors(errors);
            this.logger.warn(`Preset validation failed for "${presetDto.name}": ${JSON.stringify(detailedErrors)}`);
            throw new BadRequestException({
                message: "Invalid strategy configuration in preset",
                detail: detailedErrors,
            });
        }
        let preset = await this.presetRepository.findOne({
            where: { name: presetDto.name },
        });
        const action = preset ? "UPDATE_PRESET" : "CREATE_PRESET";
        if (preset) {
            preset.config = presetDto.config;
            await this.presetRepository.save(preset);
            this.logger.log(`Preset updated: ${presetDto.name} by ${clientIp}`);
        }
        else {
            preset = this.presetRepository.create({
                name: presetDto.name,
                config: presetDto.config,
            });
            await this.presetRepository.save(preset);
            this.logger.log(`New preset created: ${presetDto.name} by ${clientIp}`);
        }
        await this.auditLog.log({
            action,
            actor: clientIp,
            ip: clientIp,
            userAgent: req.headers["user-agent"],
            details: { name: presetDto.name },
        });
        return preset;
    }
    async deletePreset(name, req) {
        if (!name ||
            typeof name !== "string" ||
            name.trim() === "" ||
            name.length > 100) {
            throw new BadRequestException("Invalid preset name format or length");
        }
        // SEC-SENTINEL: Validate input pattern to prevent directory traversal, SQL injection, null-bytes, or malicious attacks
        if (name.includes('/') ||
            name.includes('\\') ||
            name.includes('..') ||
            name.includes(';') ||
            name.includes('\0')) {
            throw new BadRequestException("Invalid characters or path traversal attempt in preset name");
        }
        // SEC-SENTINEL: Prevent HTML tag injection or XSS payloads
        if (/<[a-zA-Z!/]/.test(name)) {
            throw new BadRequestException("Preset name cannot contain HTML tags or tag-like structures");
        }
        // SEC-SENTINEL: Enforce strict character whitelist matching CreateStrategyPresetDto to prevent injection vectors
        if (!/^[a-zA-Z0-9_\s.\-()><=%+,\[\]]+$/.test(name)) {
            throw new BadRequestException("Preset name contains invalid characters");
        }
        const clientIp = req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
        const preset = await this.presetRepository.findOne({
            where: { name },
        });
        if (!preset) {
            throw new NotFoundException(`Preset with name "${name}" not found`);
        }
        await this.presetRepository.remove(preset);
        this.logger.log(`Preset deleted: ${name} by ${clientIp}`);
        await this.auditLog.log({
            action: "DELETE_PRESET",
            actor: clientIp,
            ip: clientIp,
            userAgent: req.headers["user-agent"],
            details: { name },
        });
        return { success: true };
    }
};
__decorate([
    Get(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], PresetsController.prototype, "listPresets", null);
__decorate([
    Post(),
    __param(0, Body()),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CreateStrategyPresetDto, Object]),
    __metadata("design:returntype", Promise)
], PresetsController.prototype, "savePreset", null);
__decorate([
    Delete(":name"),
    __param(0, Param("name")),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], PresetsController.prototype, "deletePreset", null);
PresetsController = PresetsController_1 = __decorate([
    Controller("presets"),
    UseGuards(ApiKeyGuard),
    __param(0, InjectRepository(StrategyPreset)),
    __metadata("design:paramtypes", [Repository,
        AuditLogService])
], PresetsController);
export { PresetsController };
