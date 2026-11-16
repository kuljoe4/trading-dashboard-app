import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { ConfigService } from '@nestjs/config';
describe('AuthController', () => {
    let controller;
    beforeEach(async () => {
        const module = await Test.createTestingModule({
            controllers: [AuthController],
            providers: [
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn((key) => {
                            if (key === 'ADMIN_API_KEY')
                                return 'secret-key';
                            return null;
                        }),
                    },
                },
            ],
        }).compile();
        controller = module.get(AuthController);
    });
    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
    it('should NOT return ADMIN_API_KEY', () => {
        const config = controller.getConfig();
        expect(config).toHaveProperty('authMode', 'api-key');
        expect(config).not.toHaveProperty('adminApiKey');
    });
});
