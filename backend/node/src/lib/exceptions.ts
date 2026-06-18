import { HttpException, HttpStatus } from '@nestjs/common';

export class MomentumException extends HttpException {
  constructor(message: string, status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR, public readonly code?: string) {
    super(message, status);
  }
}

export class RiskGateException extends MomentumException {
  constructor(message: string) {
    super(message, HttpStatus.FORBIDDEN, 'RISK_GATE_VIOLATION');
  }
}

export class ExchangeExecutionException extends MomentumException {
  constructor(message: string, public readonly originalError?: any) {
    super(message, HttpStatus.BAD_GATEWAY, 'EXCHANGE_EXECUTION_ERROR');
  }
}

export class ConfigValidationException extends MomentumException {
  constructor(message: string) {
    super(message, HttpStatus.BAD_REQUEST, 'CONFIG_VALIDATION_ERROR');
  }
}
