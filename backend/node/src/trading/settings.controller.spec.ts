import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { SettingsController, maskApiKey } from './settings.controller';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { AuditLogService } from './audit-log.service';
import { BinanceClientFactory } from '../lib/binanceClientFactory';
import { encrypt } from '../lib/crypto';

describe('Sentinel: maskApiKey helper security verification', () => {
  it('should return empty string for non-string, empty, or falsy values', () => {
    expect(maskApiKey(null)).toBe('');
    expect(maskApiKey(undefined)).toBe('');
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey('   ')).toBe('');
    expect(maskApiKey(12345678)).toBe('');
    expect(maskApiKey({})).toBe('');
  });

  it('should completely mask short keys (< 16 chars) to prevent disclosure', () => {
    expect(maskApiKey('abc')).toBe('***');
    expect(maskApiKey('test-key-1')).toBe('********');
    expect(maskApiKey('123456789012345')).toBe('********');
  });

  it('should safely preview keys that are 16 characters or longer', () => {
    // 16 chars key
    expect(maskApiKey('abcdefghijklmnop')).toBe('abcd...mnop');

    // 64 chars standard key
    const standardKey = 'A'.repeat(64);
    expect(maskApiKey(standardKey)).toBe('AAAA...AAAA');
  });
});

describe('SettingsController: updateKeys masked key bypass prevention', () => {
  let controller: SettingsController;
  let repo: any;
  let auditLog: any;

  const mockRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockAuditLog = {
    log: jest.fn(),
  };

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = 'super-secret-encryption-key-for-testing';
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [
        {
          provide: getRepositoryToken(SettingsEntity),
          useValue: mockRepo,
        },
        {
          provide: AuditLogService,
          useValue: mockAuditLog,
        },
        {
          provide: BinanceClientFactory,
          useValue: {},
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<SettingsController>(SettingsController);
    repo = module.get(getRepositoryToken(SettingsEntity));
    auditLog = module.get(AuditLogService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should skip updating fields that contain "..." but correctly encrypt and update valid fields', async () => {
    const existingSettings = {
      id: 'default',
      binance_api_key: 'old_encrypted_key',
      binance_api_secret: 'old_encrypted_secret',
      binance_testnet_api_key: 'old_encrypted_testnet_key',
      binance_testnet_api_secret: 'old_encrypted_testnet_secret',
    };

    repo.findOne.mockResolvedValue(existingSettings);
    repo.save.mockResolvedValue(existingSettings);
    mockAuditLog.log.mockResolvedValue(undefined);

    const dto = {
      api_key: 'new_valid_live_api_key_long_enough',
      api_secret: 'masked...secret', // contains "..."
      testnet_api_key: 'masked_testnet...key', // contains "..."
      testnet_api_secret: 'new_valid_testnet_api_secret_long_enough',
    };

    const req = {
      ip: '127.0.0.1',
      headers: { 'user-agent': 'test-agent' },
    } as any;

    const result = await controller.updateKeys(dto, req);

    expect(result).toEqual({ status: 'saved' });

    // Verify fine-grained persistence updates
    expect(existingSettings.binance_api_key).not.toBe('old_encrypted_key');
    expect(existingSettings.binance_api_key).not.toContain('new_valid_live_api_key_long_enough'); // encrypted!

    // api_secret was skipped because it contained '...'
    expect(existingSettings.binance_api_secret).toBe('old_encrypted_secret');

    // testnet_api_key was skipped because it contained '...'
    expect(existingSettings.binance_testnet_api_key).toBe('old_encrypted_testnet_key');

    // testnet_api_secret was updated because it did not contain '...'
    expect(existingSettings.binance_testnet_api_secret).not.toBe('old_encrypted_testnet_secret');
    expect(existingSettings.binance_testnet_api_secret).not.toContain('new_valid_testnet_api_secret_long_enough'); // encrypted!

    // Save should be called with updated settings
    expect(repo.save).toHaveBeenCalledWith(existingSettings);

    // Audit log should be triggered with updated fields list (only the non-masked fields that actually updated)
    expect(mockAuditLog.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE_EXCHANGE_CREDENTIALS',
      actor: '127.0.0.1',
      details: {
        fields: ['binance_api_key', 'binance_testnet_api_secret'],
      },
    }));
  });
});

describe('SettingsController: validateKeys error sanitization', () => {
  let controller: SettingsController;
  let binanceClientFactory: any;
  let repo: any;

  const mockRepo = {
    findOne: jest.fn(),
  };

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = 'super-secret-encryption-key-for-testing';
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockBinanceClientFactory = {
      createClient: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [
        {
          provide: getRepositoryToken(SettingsEntity),
          useValue: mockRepo,
        },
        {
          provide: AuditLogService,
          useValue: { log: jest.fn() },
        },
        {
          provide: BinanceClientFactory,
          useValue: mockBinanceClientFactory,
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<SettingsController>(SettingsController);
    binanceClientFactory = module.get(BinanceClientFactory);
    repo = module.get(getRepositoryToken(SettingsEntity));
  });

  it('should sanitize sensitive error messages containing API keys or secrets during validateKeys', async () => {
    mockRepo.findOne.mockResolvedValue(null);

    const mockClient = {
      restAPI: {
        futuresAccountBalanceV3: jest.fn().mockRejectedValue({
          message: 'Failed request with api_key=secret_key_123456 and secret=super_secret_password',
          code: -1022,
        }),
      },
    };

    binanceClientFactory.createClient.mockReturnValue(mockClient);

    const dto = {
      api_key: 'valid_live_api_key_test_12345',
      api_secret: 'valid_live_api_secret_test_12345',
    };

    const result = await controller.validateKeys(dto);

    expect(result.valid).toBe(false);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].type).toBe('live');
    expect(result.checks[0].status).toBe('invalid');

    // Sensitive key values must be masked
    expect(result.checks[0].message).not.toContain('secret_key_123456');
    expect(result.checks[0].message).not.toContain('super_secret_password');
    expect(result.checks[0].message).toContain('[MASKED]');
  });
});
