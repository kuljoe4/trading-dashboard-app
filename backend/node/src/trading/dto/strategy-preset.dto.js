var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { IsString, IsNotEmpty, IsObject, MaxLength, ValidateNested, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { SessionConfig } from '../../models/SessionConfig';
export class CreateStrategyPresetDto {
    name;
    config;
}
__decorate([
    IsString(),
    IsNotEmpty(),
    MaxLength(100),
    Matches(/^[a-zA-Z0-9_\s.\-()><=%+,\[\]]+$/, { message: 'Preset name can only contain alphanumeric characters, spaces, underscores, dots, hyphens, and safe descriptive characters like (), ><=, %, +, ,, and []' }),
    Matches(/^(?!.*<[a-zA-Z!/]).*$/, { message: 'Preset name cannot contain HTML tags or tag-like structures' }),
    __metadata("design:type", String)
], CreateStrategyPresetDto.prototype, "name", void 0);
__decorate([
    IsObject(),
    IsNotEmpty(),
    ValidateNested(),
    Type(() => SessionConfig),
    __metadata("design:type", SessionConfig)
], CreateStrategyPresetDto.prototype, "config", void 0);
export class UpdateStrategyPresetDto {
    name;
    config;
}
__decorate([
    IsString(),
    IsNotEmpty(),
    MaxLength(100),
    Matches(/^[a-zA-Z0-9_\s.\-()><=%+,\[\]]+$/, { message: 'Preset name can only contain alphanumeric characters, spaces, underscores, dots, hyphens, and safe descriptive characters like (), ><=, %, +, ,, and []' }),
    Matches(/^(?!.*<[a-zA-Z!/]).*$/, { message: 'Preset name cannot contain HTML tags or tag-like structures' }),
    __metadata("design:type", String)
], UpdateStrategyPresetDto.prototype, "name", void 0);
__decorate([
    IsObject(),
    IsNotEmpty(),
    ValidateNested(),
    Type(() => SessionConfig),
    __metadata("design:type", SessionConfig)
], UpdateStrategyPresetDto.prototype, "config", void 0);
