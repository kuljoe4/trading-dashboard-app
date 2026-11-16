import { HttpException, HttpStatus } from '@nestjs/common';
export class MomentumException extends HttpException {
    code;
    constructor(message, status = HttpStatus.INTERNAL_SERVER_ERROR, code) {
        super(message, status);
        this.code = code;
    }
}
export class RiskGateException extends MomentumException {
    constructor(message) {
        super(message, HttpStatus.FORBIDDEN, 'RISK_GATE_VIOLATION');
    }
}
export class ExchangeExecutionException extends MomentumException {
    originalError;
    constructor(message, originalError) {
        super(message, HttpStatus.BAD_GATEWAY, 'EXCHANGE_EXECUTION_ERROR');
        this.originalError = originalError;
    }
}
export class ConfigValidationException extends MomentumException {
    constructor(message) {
        super(message, HttpStatus.BAD_REQUEST, 'CONFIG_VALIDATION_ERROR');
    }
}
