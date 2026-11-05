var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { IsString, IsOptional, MaxLength, Matches } from 'class-validator';
export class UpdateKeysDto {
    api_key;
    api_secret;
    testnet_api_key;
    testnet_api_secret;
    proxy_url;
}
__decorate([
    IsString(),
    IsOptional(),
    MaxLength(500),
    Matches(/^[a-zA-Z0-9_\-\.\+/= ]*$/, { message: 'API key contains invalid characters' }),
    __metadata("design:type", String)
], UpdateKeysDto.prototype, "api_key", void 0);
__decorate([
    IsString(),
    IsOptional(),
    MaxLength(500),
    Matches(/^[a-zA-Z0-9_\-\.\+/= ]*$/, { message: 'API secret contains invalid characters' }),
    __metadata("design:type", String)
], UpdateKeysDto.prototype, "api_secret", void 0);
__decorate([
    IsString(),
    IsOptional(),
    MaxLength(500),
    Matches(/^[a-zA-Z0-9_\-\.\+/= ]*$/, { message: 'Testnet API key contains invalid characters' }),
    __metadata("design:type", String)
], UpdateKeysDto.prototype, "testnet_api_key", void 0);
__decorate([
    IsString(),
    IsOptional(),
    MaxLength(500),
    Matches(/^[a-zA-Z0-9_\-\.\+/= ]*$/, { message: 'Testnet API secret contains invalid characters' }),
    __metadata("design:type", String)
], UpdateKeysDto.prototype, "testnet_api_secret", void 0);
__decorate([
    IsString(),
    IsOptional(),
    MaxLength(255),
    Matches(/^https?:\/\/[a-zA-Z0-9_\-\.:@]*$/, { message: 'Proxy URL must start with http:// or https:// and contain valid characters' }),
    __metadata("design:type", String)
], UpdateKeysDto.prototype, "proxy_url", void 0);
