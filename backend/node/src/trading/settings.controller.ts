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
import { BinanceClientFactory } from '../lib/binanceClientFactory';

@Controller('settings')
@UseGuards(ApiKeyGuard)
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);

  constructor(
    @InjectRepository(SettingsEntity)
    private settingsRepository: Repository<SettingsEntity>,
    private readonly auditLog: AuditLogService,
    private readonly binanceClientFactory: BinanceClientFactory,
  ) {}

  @Get('keys')
  async getKeys(@Req() req: Request) {
    const settings = await this.settingsRepository.findOne({
      where: { id: 'default' },
      select: ['id', 'binance_api_key', 'binance_testnet_api_key']
    });

    const clientIp = req.ip || extractIp(req.headers, req.socket?.remoteAddress || 'unknown');
    const userAgent = req.headers['user-agent'];

    await this.auditLog.log({
      action: 'VIEW_EXCHANGE_KEYS',
      actor: clientIp,
      ip: clientIp,
      userAgent,
      level: 'INFO'
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

    const settings = await this.settingsRepository.findOne({
      where: { id: 'default' },
    });

    const savedApiKey = decrypt(settings?.binance_api_key);
    const savedApiSecret = decrypt(settings?.binance_api_secret);
    const savedTestnetKey = decrypt(settings?.binance_testnet_api_key);
    const savedTestnetSecret = decrypt(settings?.binance_testnet_api_secret);

    // Test live key and secret using signed futuresAccountBalanceV3 endpoint
    let liveKeyToTest = body.api_key;
    let liveSecretToTest = body.api_secret;

    const isLiveMaskedOrEmpty = !liveKeyToTest || liveKeyToTest.includes('...') || liveKeyToTest.trim() === '';
    if (isLiveMaskedOrEmpty) {
      liveKeyToTest = savedApiKey;
      liveSecretToTest = savedApiSecret;
    }

    if (liveKeyToTest && liveSecretToTest) {
      try {
        const client = this.binanceClientFactory.createClient(liveKeyToTest.trim(), liveSecretToTest.trim(), false);
        const res = await client.restAPI.futuresAccountBalanceV3({ asset: 'USDT' } as any);
        if (res && (res.status === 200 || res.status === 201)) {
          results.checks.push({
            type: 'live',
            status: 'valid',
            message: 'Live API key & secret are valid and can access Binance'
          });
        } else {
          throw new Error(`Unexpected status ${res ? res.status : 'unknown'}`);
        }
      } catch (err: any) {
        results.valid = false;
        const code = err.code || (err.data ? err.data.code : null);
        const errMsg = err.data?.msg || err.message || 'Verification failed';
        results.checks.push({
          type: 'live',
          status: 'invalid',
          message: `Live key failed: ${errMsg}`,
          code: code
        });
        // SENTINEL: Only log safe fields to prevent leakage of credentials in full error objects
        this.logger.error(`Live API key validation failed: ${JSON.stringify({ msg: errMsg, code })}`);
      }
    } else if (body.api_key && !isLiveMaskedOrEmpty && !liveSecretToTest) {
      results.valid = false;
      results.checks.push({
        type: 'live',
        status: 'invalid',
        message: 'Secret key is required to validate the API key'
      });
    }

    // Test testnet key and secret using signed futuresAccountBalanceV3 endpoint
    let testnetKeyToTest = body.testnet_api_key;
    let testnetSecretToTest = body.testnet_api_secret;

    const isTestnetMaskedOrEmpty = !testnetKeyToTest || testnetKeyToTest.includes('...') || testnetKeyToTest.trim() === '';
    if (isTestnetMaskedOrEmpty) {
      testnetKeyToTest = savedTestnetKey;
      testnetSecretToTest = savedTestnetSecret;
    }

    if (testnetKeyToTest && testnetSecretToTest) {
      try {
        const client = this.binanceClientFactory.createClient(testnetKeyToTest.trim(), testnetSecretToTest.trim(), true);
        const res = await client.restAPI.futuresAccountBalanceV3({ asset: 'USDT' } as any);
        if (res && (res.status === 200 || res.status === 201)) {
          results.checks.push({
            type: 'testnet',
            status: 'valid',
            message: 'Testnet API key & secret are valid and can access Binance Testnet'
          });
        } else {
          throw new Error(`Unexpected status ${res ? res.status : 'unknown'}`);
        }
      } catch (err: any) {
        results.valid = false;
        const code = err.code || (err.data ? err.data.code : null);
        const errMsg = err.data?.msg || err.message || 'Verification failed';
        results.checks.push({
          type: 'testnet',
          status: 'invalid',
          message: `Testnet key failed: ${errMsg}`,
          code: code
        });
        // SENTINEL: Only log safe fields to prevent leakage of credentials in full error objects
        this.logger.error(`Testnet API key validation failed: ${JSON.stringify({ msg: errMsg, code })}`);
      }
    } else if (body.testnet_api_key && !isTestnetMaskedOrEmpty && !testnetSecretToTest) {
      results.valid = false;
      results.checks.push({
        type: 'testnet',
        status: 'invalid',
        message: 'Testnet secret key is required to validate the API key'
      });
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
      // SENTINEL: Do NOT use JSON.stringify(err) as it can leak credentials if the error contains the settings entity
      this.logger.error(`Update failed for IP: ${req.ip || 'unknown'}`);
      throw err;
    }
  }
}
