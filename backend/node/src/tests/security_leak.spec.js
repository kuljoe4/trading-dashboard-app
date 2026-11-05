import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SessionService } from '../trading/session.service';
import { SessionConfig } from '../models/SessionConfig';
import { formatValidationErrors } from '../lib/logger';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
describe('Sentinel: Information Leakage Check', () => {
    let service;
    beforeEach(async () => {
        const module = await Test.createTestingModule({
            providers: [
                {
                    provide: SessionService,
                    useValue: {
                        executeUpdateSession: async (id, partialConfig) => {
                            // Simulating the behavior in executeUpdateSession BEFORE the fix
                            const mergedConfig = { ...partialConfig };
                            const configInstance = plainToInstance(SessionConfig, mergedConfig);
                            const errors = await validate(configInstance);
                            if (errors.length > 0) {
                                // This is what I suspect is happening in SessionService.ts
                                throw new BadRequestException({
                                    message: "Invalid configuration parameters",
                                    detail: errors
                                });
                            }
                        }
                    },
                },
            ],
        }).compile();
        service = module.get(SessionService);
    });
    it('should verify if ValidationError.value is leaked in BadRequestException AFTER FIX', async () => {
        const module = await Test.createTestingModule({
            providers: [
                {
                    provide: SessionService,
                    useValue: {
                        executeUpdateSession: async (id, partialConfig) => {
                            // Simulating the behavior in executeUpdateSession AFTER the fix
                            const mergedConfig = { ...partialConfig };
                            const configInstance = plainToInstance(SessionConfig, mergedConfig);
                            const errors = await validate(configInstance);
                            const detailedErrors = formatValidationErrors(errors);
                            if (errors.length > 0) {
                                throw new BadRequestException({
                                    message: "Invalid configuration parameters",
                                    detail: detailedErrors
                                });
                            }
                        }
                    },
                },
            ],
        }).compile();
        const serviceAfterFix = module.get(SessionService);
        try {
            // Providing a number where a string is expected to trigger validation error
            await serviceAfterFix.executeUpdateSession('id', { strategy_label: 123 });
        }
        catch (e) {
            const response = e.getResponse();
            expect(response.detail).toBeDefined();
            // value should now be undefined in detailedErrors
            expect(response.detail[0].value).toBeUndefined();
            expect(response.detail[0].property).toBe('strategy_label');
        }
    });
    it('formatValidationErrors should remove the value property', () => {
        const errors = [
            {
                property: 'strategy_label',
                value: 'SENSITIVE_VALUE_123',
                constraints: { isString: 'strategy_label must be a string' },
                children: []
            }
        ];
        const formatted = formatValidationErrors(errors);
        expect(formatted[0].value).toBeUndefined();
        expect(formatted[0].property).toBe('strategy_label');
    });
});
