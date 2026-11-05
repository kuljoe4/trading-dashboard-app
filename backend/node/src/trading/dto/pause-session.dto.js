var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { IsBoolean, IsOptional, IsString, MaxLength, Matches } from 'class-validator';
export class PauseSessionDto {
    paused;
    strategyLabel;
}
__decorate([
    IsBoolean(),
    __metadata("design:type", Boolean)
], PauseSessionDto.prototype, "paused", void 0);
__decorate([
    IsString(),
    IsOptional(),
    MaxLength(100, { message: 'Strategy label cannot exceed 100 characters' }),
    Matches(/^[a-zA-Z0-9_\s.\-()><=%+,\[\]]*$/, { message: 'Strategy label can only contain alphanumeric characters, spaces, underscores, dots, hyphens, and safe descriptive characters like (), ><=, %, +, ,, and []' }),
    Matches(/^(?!.*<[a-zA-Z!/]).*$/, { message: 'Strategy label cannot contain HTML tags or tag-like structures' }),
    __metadata("design:type", String)
], PauseSessionDto.prototype, "strategyLabel", void 0);
