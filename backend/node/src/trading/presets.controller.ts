import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Request } from "express";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { StrategyPreset } from "../models/entities/StrategyPreset.entity";
import {
  CreateStrategyPresetDto,
  UpdateStrategyPresetDto,
} from "./dto/strategy-preset.dto";
import { SessionConfig } from "../models/SessionConfig";
import { ApiKeyGuard } from "../lib/api-key.guard";
import { AuditLogService } from "./audit-log.service";
import { extractIp } from "../lib/throttle";
import { formatValidationErrors } from "../lib/logger";

@Controller("presets")
@UseGuards(ApiKeyGuard)
export class PresetsController {
  private readonly logger = new Logger(PresetsController.name);

  constructor(
    @InjectRepository(StrategyPreset)
    private readonly presetRepository: Repository<StrategyPreset>,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  async listPresets() {
    return this.presetRepository.find({
      order: { name: "ASC" },
    });
  }

  @Post()
  async savePreset(@Body() body: CreateStrategyPresetDto, @Req() req: Request) {
    const clientIp =
      req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");

    // SEC-SENTINEL: Defense-in-depth validation of the outer preset DTO and strategy configuration
    // SENTINEL: Enforce whitelist and forbidNonWhitelisted to prevent arbitrary parameter injection/pollution in preset configuration
    const presetDto = plainToInstance(CreateStrategyPresetDto, body || {});
    const dtoErrors = await validate(presetDto, { whitelist: true, forbidNonWhitelisted: true });
    if (dtoErrors.length > 0) {
      const detailedErrors = formatValidationErrors(dtoErrors);
      this.logger.warn(
        `Preset DTO validation failed: ${JSON.stringify(detailedErrors)}`,
      );
      throw new BadRequestException({
        message: "Invalid strategy preset parameters",
        detail: detailedErrors,
      });
    }

    const normalizedName = typeof presetDto.name === "string" ? presetDto.name.trim() : "";
    if (!normalizedName) {
      throw new BadRequestException("Preset name cannot be empty");
    }

    const configInstance = plainToInstance(SessionConfig, presetDto.config || {});
    const errors = await validate(configInstance, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
      const detailedErrors = formatValidationErrors(errors);
      this.logger.warn(
        `Preset validation failed for "${normalizedName}": ${JSON.stringify(detailedErrors)}`,
      );
      throw new BadRequestException({
        message: "Invalid strategy configuration in preset",
        detail: detailedErrors,
      });
    }

    let preset = await this.presetRepository.findOne({
      where: { name: normalizedName },
    });

    if (preset && presetDto.overwrite === false) {
      this.logger.warn(
        `Preset save blocked (overwrite=false): "${normalizedName}" already exists (requested by ${clientIp})`,
      );
      throw new ConflictException(
        `A preset named "${normalizedName}" already exists. Choose a different name or confirm overwrite.`,
      );
    }

    const action = preset ? "UPDATE_PRESET" : "CREATE_PRESET";
    if (preset) {
      preset.config = presetDto.config;
      await this.presetRepository.save(preset);
      this.logger.log(`Preset updated: ${normalizedName} by ${clientIp}`);
    } else {
      preset = this.presetRepository.create({
        name: normalizedName,
        config: presetDto.config,
      });
      await this.presetRepository.save(preset);
      this.logger.log(`New preset created: ${normalizedName} by ${clientIp}`);
    }

    await this.auditLog.log({
      action,
      actor: clientIp,
      ip: clientIp,
      userAgent: req.headers["user-agent"],
      details: { name: normalizedName },
    });

    return preset;
  }

  @Delete(":name")
  async deletePreset(@Param("name") name: string, @Req() req: Request) {
    if (
      !name ||
      typeof name !== "string" ||
      name.trim() === "" ||
      name.length > 100
    ) {
      throw new BadRequestException("Invalid preset name format or length");
    }
    // SEC-SENTINEL: Validate input pattern to prevent directory traversal, SQL injection, null-bytes, or malicious attacks
    if (
      name.includes('/') ||
      name.includes('\\') ||
      name.includes('..') ||
      name.includes(';') ||
      name.includes('\0')
    ) {
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
    const clientIp =
      req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");

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
}
