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

    // SEC-SENTINEL: Defense-in-depth validation of the strategy configuration
    const configInstance = plainToInstance(SessionConfig, body.config || {});
    const errors = await validate(configInstance);
    if (errors.length > 0) {
      const detailedErrors = formatValidationErrors(errors);
      this.logger.warn(
        `Preset validation failed for "${body.name}": ${JSON.stringify(detailedErrors)}`,
      );
      throw new BadRequestException({
        message: "Invalid strategy configuration in preset",
        detail: detailedErrors,
      });
    }

    let preset = await this.presetRepository.findOne({
      where: { name: body.name },
    });

    const action = preset ? "UPDATE_PRESET" : "CREATE_PRESET";
    if (preset) {
      preset.config = body.config;
      await this.presetRepository.save(preset);
      this.logger.log(`Preset updated: ${body.name} by ${clientIp}`);
    } else {
      preset = this.presetRepository.create({
        name: body.name,
        config: body.config,
      });
      await this.presetRepository.save(preset);
      this.logger.log(`New preset created: ${body.name} by ${clientIp}`);
    }

    await this.auditLog.log({
      action,
      actor: clientIp,
      ip: clientIp,
      userAgent: req.headers["user-agent"],
      details: { name: body.name },
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
    // SEC-SENTINEL: Validate input pattern to prevent directory traversal or malicious character attacks
    if (!/^[a-zA-Z0-9_\s.\-()><=%+,\[\]]+$/.test(name)) {
      throw new BadRequestException("Invalid characters in preset name");
    }
    // SEC-SENTINEL: Prevent HTML tag injection or XSS payloads
    if (/<[a-zA-Z!/]/.test(name)) {
      throw new BadRequestException("Preset name cannot contain HTML tags or tag-like structures");
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
