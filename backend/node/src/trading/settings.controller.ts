import { Body, Controller, Get, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';

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
  async updateKeys(@Body() body: { api_key?: string; api_secret?: string }) {
    let settings = await this.settingsRepository.findOne({ where: { id: 'default' } });
    if (!settings) {
      settings = this.settingsRepository.create({ id: 'default' });
    }

    settings.binance_api_key = body.api_key || '';
    settings.binance_api_secret = body.api_secret || '';

    await this.settingsRepository.save(settings);

    return { status: 'saved' };
  }
}
