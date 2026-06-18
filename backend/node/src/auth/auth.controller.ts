import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller('auth')
export class AuthController {
  constructor(private configService: ConfigService) {}

  @Get('config')
  getConfig() {
    return {
      // Security fix: Do NOT return the ADMIN_API_KEY.
      // The frontend should obtain this from user input or localStorage.
      authMode: 'api-key',
    };
  }
}
