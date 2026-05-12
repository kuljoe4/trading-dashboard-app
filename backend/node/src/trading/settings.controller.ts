import { Body, Controller, Get, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { UpdateKeysDto } from './dto/update-keys.dto';

@Controller('settings')
export class SettingsController {
  constructor(
    @InjectRepository(SettingsEntity)
    private settingsRepository: Repository<SettingsEntity>,
  ) {}

  @Get('keys')
  async getKeys() {
    const settings = await this.settingsRepository.findOne({ where: { id: 'default' } });
    return {
      api_key: settings?.binance_api_key
        ? `${settings.binance_api_key.slice(0, 4)}...${settings.binance_api_key.slice(-4)}`
        : '',
    };
  }

  @Post('keys')
  async updateKeys(@Body() body: UpdateKeysDto) {
    let settings = await this.settingsRepository.findOne({ where: { id: 'default' } });
    if (!settings) {
      settings = this.settingsRepository.create({ id: 'default' });
    }

    // Only update if provided, preventing clearing keys with empty strings
    if (body.api_key !== undefined) {
      settings.binance_api_key = body.api_key;
    }
    if (body.api_secret !== undefined) {
      settings.binance_api_secret = body.api_secret;
    }

    await this.settingsRepository.save(settings);

    return { status: 'saved' };
  }
}
