var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
let AuthController = class AuthController {
    configService;
    constructor(configService) {
        this.configService = configService;
    }
    getConfig() {
        return {
            // Security fix: Do NOT return the ADMIN_API_KEY.
            // The frontend should obtain this from user input or localStorage.
            authMode: 'api-key',
        };
    }
};
__decorate([
    Get('config'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "getConfig", null);
AuthController = __decorate([
    Controller('auth'),
    __metadata("design:paramtypes", [ConfigService])
], AuthController);
export { AuthController };
