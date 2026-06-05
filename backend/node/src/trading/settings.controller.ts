import { Body, Controller, Get, Post, UseGuards, Logger, Req } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { UpdateKeysDto } from './dto/update-keys.dto';
import { encrypt, decrypt } from '../lib/crypto';
import { ApiKeyGuard } from '../lib/api-key.guard';
import { extractIp } from '../lib/throttle';
import { AuditLogService } from './audit-log.service';

@Controller('settings')
@UseGuards(ApiKeyGuard)
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);

  constructor(
    @InjectRepository(SettingsEntity)
    private settingsRepository: Repository<SettingsEntity>,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get('keys')
  async getKeys() {
    const settings = await this.settingsRepository.findOne({
      where: { id: 'default' },
      select: ['id', 'binance_api_key', 'binance_testnet_api_key']
    });

    const apiKey = decrypt(settings?.binance_api_key);
    const testnetApiKey = decrypt(settings?.binance_testnet_api_key);

    return {
      api_key: apiKey
        ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`
        : '',
      testnet_api_key: testnetApiKey
        ? `${testnetApiKey.slice(0, 4)}...${testnetApiKey.slice(-4)}`
        : '',
    };
  }

  @Post('keys')
  async updateKeys(@Body() body: UpdateKeysDto, @Req() req: Request) {
    let settings = await this.settingsRepository.findOne({
      where: { id: 'default' },
      select: ['id', 'binance_api_key', 'binance_api_secret', 'binance_testnet_api_key', 'binance_testnet_api_secret']
    });
    if (!settings) {
      settings = this.settingsRepository.create({ id: 'default' });
    }

    const updatedFields: string[] = [];
    const clientIp = extractIp(req.headers, req.ip || req.socket?.remoteAddress || 'unknown');

    // Security: Only update if explicitly provided to prevent accidental deletion
    // Also trim whitespace to prevent common copy-paste issues
    if (body.api_key !== undefined) {
      const trimmedKey = body.api_key.trim();
      if (trimmedKey) {
        settings.binance_api_key = encrypt(trimmedKey);
        updatedFields.push('binance_api_key');
      }
    }
    if (body.api_secret !== undefined) {
      const trimmedSecret = body.api_secret.trim();
      if (trimmedSecret) {
        settings.binance_api_secret = encrypt(trimmedSecret);
        updatedFields.push('binance_api_secret');
      }
    }

    if (body.testnet_api_key !== undefined) {
      const trimmedKey = body.testnet_api_key.trim();
      if (trimmedKey) {
        settings.binance_testnet_api_key = encrypt(trimmedKey);
        updatedFields.push('binance_testnet_api_key');
      }
    }
    if (body.testnet_api_secret !== undefined) {
      const trimmedSecret = body.testnet_api_secret.trim();
      if (trimmedSecret) {
        settings.binance_testnet_api_secret = encrypt(trimmedSecret);
        updatedFields.push('binance_testnet_api_secret');
      }
    }

    if (updatedFields.length > 0) {
      this.logger.warn(`AUDIT: Binance API credentials (${updatedFields.join(', ')}) updated from IP: ${clientIp}`);

      await this.auditLog.log({
        action: 'UPDATE_EXCHANGE_CREDENTIALS',
        actor: clientIp,
        details: { fields: updatedFields }
      });
    }

    await this.settingsRepository.save(settings);

    return { status: 'saved' };
  }
}
