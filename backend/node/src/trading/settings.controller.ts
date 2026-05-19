import { Body, Controller, Get, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { UpdateKeysDto } from './dto/update-keys.dto';
import { encrypt } from '../lib/crypto';

@Controller('settings')
export class SettingsController {
  constructor(
    @InjectRepository(SettingsEntity)
    private settingsRepository: Repository<SettingsEntity>,
  ) {}

  @Get('keys')
  async getKeys() {
    const settings = await this.settingsRepository.findOne({
      where: { id: 'default' },
      select: ['id', 'binance_api_key', 'binance_testnet_api_key']
    });
    return {
      api_key: settings?.binance_api_key
        ? `${settings.binance_api_key.slice(0, 4)}...${settings.binance_api_key.slice(-4)}`
        : '',
      testnet_api_key: settings?.binance_testnet_api_key
        ? `${settings.binance_testnet_api_key.slice(0, 4)}...${settings.binance_testnet_api_key.slice(-4)}`
        : '',
    };
  }

  @Post('keys')
  async updateKeys(@Body() body: UpdateKeysDto) {
    let settings = await this.settingsRepository.findOne({
      where: { id: 'default' },
      select: ['id', 'binance_api_key', 'binance_api_secret', 'binance_testnet_api_key', 'binance_testnet_api_secret']
    });
    if (!settings) {
      settings = this.settingsRepository.create({ id: 'default' });
    }

    // Security: Only update if explicitly provided to prevent accidental deletion
    // Also trim whitespace to prevent common copy-paste issues
    if (body.api_key !== undefined) {
      const trimmedKey = body.api_key.trim();
      if (trimmedKey) {
        settings.binance_api_key = trimmedKey;
      }
    }
    if (body.api_secret !== undefined) {
      const trimmedSecret = body.api_secret.trim();
      if (trimmedSecret) {
        settings.binance_api_secret = encrypt(trimmedSecret);
      }
    }

    if (body.testnet_api_key !== undefined) {
      const trimmedKey = body.testnet_api_key.trim();
      if (trimmedKey) {
        settings.binance_testnet_api_key = trimmedKey;
      }
    }
    if (body.testnet_api_secret !== undefined) {
      const trimmedSecret = body.testnet_api_secret.trim();
      if (trimmedSecret) {
        settings.binance_testnet_api_secret = encrypt(trimmedSecret);
      }
    }

    await this.settingsRepository.save(settings);

    return { status: 'saved' };
  }
}
