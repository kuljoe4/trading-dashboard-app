import { Controller, Get, Post, Delete, Body, Param, UseGuards, Req, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { StrategyPreset } from '../models/entities/StrategyPreset.entity';
import { CreateStrategyPresetDto, UpdateStrategyPresetDto } from './dto/strategy-preset.dto';
import { ApiKeyGuard } from '../lib/api-key.guard';
import { AuditLogService } from './audit-log.service';
import { extractIp } from '../lib/throttle';

@Controller('presets')
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
      order: { name: 'ASC' }
    });
  }

  @Post()
  async savePreset(@Body() body: CreateStrategyPresetDto, @Req() req: Request) {
    const clientIp = req.ip || extractIp(req.headers, req.socket?.remoteAddress || 'unknown');

    let preset = await this.presetRepository.findOne({
      where: { name: body.name }
    });

    const action = preset ? 'UPDATE_PRESET' : 'CREATE_PRESET';
    if (preset) {
      preset.config = body.config;
      await this.presetRepository.save(preset);
      this.logger.log(`Preset updated: ${body.name} by ${clientIp}`);
    } else {
      preset = this.presetRepository.create({
        name: body.name,
        config: body.config
      });
      await this.presetRepository.save(preset);
      this.logger.log(`New preset created: ${body.name} by ${clientIp}`);
    }

    await this.auditLog.log({
      action,
      actor: clientIp,
      ip: clientIp,
      userAgent: req.headers['user-agent'],
      details: { name: body.name }
    });

    return preset;
  }

  @Delete(':name')
  async deletePreset(@Param('name') name: string, @Req() req: Request) {
    const clientIp = req.ip || extractIp(req.headers, req.socket?.remoteAddress || 'unknown');

    const preset = await this.presetRepository.findOne({
      where: { name }
    });

    if (!preset) {
      throw new NotFoundException(`Preset with name "${name}" not found`);
    }

    await this.presetRepository.remove(preset);
    this.logger.log(`Preset deleted: ${name} by ${clientIp}`);

    await this.auditLog.log({
      action: 'DELETE_PRESET',
      actor: clientIp,
      ip: clientIp,
      userAgent: req.headers['user-agent'],
      details: { name }
    });

    return { success: true };
  }
}
