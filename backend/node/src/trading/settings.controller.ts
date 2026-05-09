import { Body, Controller, Get, Post } from '@nestjs/common';

@Controller('settings')
export class SettingsController {
  private static apiKey = '';
  private static apiSecret = '';

  @Get('keys')
  getKeys() {
    return {
      api_key: SettingsController.apiKey
        ? `${SettingsController.apiKey.slice(0, 4)}...${SettingsController.apiKey.slice(-4)}`
        : '',
    };
  }

  @Post('keys')
  updateKeys(@Body() body: { api_key?: string; api_secret?: string }) {
    SettingsController.apiKey = body.api_key || '';
    SettingsController.apiSecret = body.api_secret || '';

    return { status: 'saved' };
  }
}
