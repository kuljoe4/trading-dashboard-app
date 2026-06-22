import { Body, Controller, Get, Post, UseGuards, Logger, Req } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { UpdateKeysDto } from './dto/update-keys.dto';
import { ValidateKeysDto } from './dto/validate-keys.dto';
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

  @Post('keys/validate')
  async validateKeys(@Body() body: ValidateKeysDto) {
    const results: any = {
      valid: true,
      checks: []
    };

    // Test live API key with public endpoint to verify key format
    if (body.api_key) {
      try {
        const response = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo', {
          headers: {
            'X-MBX-APIKEY': body.api_key.trim()
          },
          signal: AbortSignal.timeout(5000)
        });
        
        if (response.ok) {
          results.checks.push({
            type: 'live',
            status: 'valid',
            message: 'Live API key is valid and can access Binance'
          });
        } else {
          const error: any = await response.json().catch(() => ({ msg: response.statusText }));
          results.valid = false;
          results.checks.push({
            type: 'live',
            status: 'invalid',
            message: `Live key failed: ${error.msg || error.message || 'Unknown error'}`,
            code: error.code
          });
          this.logger.error(`Live API key validation failed: ${JSON.stringify(error)}`);
        }
      } catch (err) {
        results.valid = false;
        const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
        results.checks.push({
          type: 'live',
          status: 'error',
          message: isTimeout
            ? 'Connection timed out while testing live key'
            : `Error testing live key: ${err instanceof Error ? err.message : 'Unknown error'}`
        });
        this.logger.error(`Live API key test error: ${err}`);
      }
    }

    // Test testnet API key with public endpoint to verify key format
    if (body.testnet_api_key) {
      try {
        const response = await fetch('https://testnet.binancefuture.com/fapi/v1/exchangeInfo', {
          headers: {
            'X-MBX-APIKEY': body.testnet_api_key.trim()
          },
          signal: AbortSignal.timeout(5000)
        });
        
        if (response.ok) {
          results.checks.push({
            type: 'testnet',
            status: 'valid',
            message: 'Testnet API key is valid and can access Binance Testnet'
          });
        } else {
          const error: any = await response.json().catch(() => ({ msg: response.statusText }));
          results.valid = false;
          results.checks.push({
            type: 'testnet',
            status: 'invalid',
            message: `Testnet key failed: ${error.msg || error.message || 'Unknown error'}`,
            code: error.code
          });
          this.logger.error(`Testnet API key validation failed: ${JSON.stringify(error)}`);
        }
      } catch (err) {
        results.valid = false;
        const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
        results.checks.push({
          type: 'testnet',
          status: 'error',
          message: isTimeout
            ? 'Connection timed out while testing testnet key'
            : `Error testing testnet key: ${err instanceof Error ? err.message : 'Unknown error'}`
        });
        this.logger.error(`Testnet API key test error: ${err}`);
      }
    }

    return results;
  }

  @Post('keys')
  async updateKeys(@Body() body: UpdateKeysDto, @Req() req: Request) {
    try {
      let settings = await this.settingsRepository.findOne({
        where: { id: 'default' },
        select: ['id', 'binance_api_key', 'binance_api_secret', 'binance_testnet_api_key', 'binance_testnet_api_secret']
      });
      
      if (!settings) {
        this.logger.log('Settings record not found, creating new one with id=default');
        settings = this.settingsRepository.create({ id: 'default' });
      }

      const updatedFields: string[] = [];
      const clientIp = req.ip || extractIp(req.headers, req.socket?.remoteAddress || 'unknown');
      const userAgent = req.headers['user-agent'];

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
          ip: clientIp,
          userAgent,
          details: { fields: updatedFields }
        });
      }

      this.logger.log(`Saving settings to database: ${JSON.stringify({ id: settings.id })}`);
      await this.settingsRepository.save(settings);
      this.logger.log('Settings saved successfully');

      return { status: 'saved' };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to update API keys: ${errorMsg}`);
      this.logger.error(`Full error: ${JSON.stringify(err)}`);
      throw err;
    }
  }
}
