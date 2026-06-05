import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller('auth')
export class AuthController {
  constructor(private configService: ConfigService) {}

  @Get('config')
  getConfig() {
    return {
      // Return only what the frontend absolutely needs.
      // Do NOT return the full secret if not strictly necessary for the frontend logic,
      // but if the frontend *must* have it to authenticate subsequent requests,
      // this is the only way to do it dynamically.
      adminApiKey: this.configService.get<string>('ADMIN_API_KEY'),
    };
  }
}
