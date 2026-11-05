var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Catch, HttpException, HttpStatus, Logger, } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { MomentumException } from './exceptions';
import { sanitize } from './logger';
let AllExceptionsFilter = class AllExceptionsFilter {
    httpAdapterHost;
    logger = new Logger('Exceptions');
    constructor(httpAdapterHost) {
        this.httpAdapterHost = httpAdapterHost;
    }
    catch(exception, host) {
        const { httpAdapter } = this.httpAdapterHost;
        const ctx = host.switchToHttp();
        const httpStatus = exception instanceof HttpException
            ? exception.getStatus()
            : HttpStatus.INTERNAL_SERVER_ERROR;
        let message = 'Internal server error';
        if (exception instanceof HttpException) {
            const response = exception.getResponse();
            message = (typeof response === 'object' && response.message) ? response.message : exception.message;
        }
        else if (exception instanceof Error) {
            message = 'Internal server error';
        }
        const responseBody = {
            statusCode: httpStatus,
            timestamp: new Date().toISOString(),
            path: httpAdapter.getRequestUrl(ctx.getRequest()),
            // SENTINEL: Prevent sensitive data leakage by forcing a generic message for 5xx errors
            // and sanitizing non-500 response messages to prevent accidental credential/key leakage to clients.
            message: httpStatus >= 500 ? 'Internal server error' : sanitize(message),
        };
        if (exception instanceof MomentumException) {
            responseBody.code = exception.code;
        }
        // Audit Item 33: Log full stack trace for unhandled exceptions
        if (httpStatus >= 500) {
            // SENTINEL: Sanitize the exception object to mask any sensitive data in custom properties
            const sanitizedException = sanitize(exception);
            const logBody = (sanitizedException && typeof sanitizedException === 'object')
                ? (sanitizedException.stack || JSON.stringify(sanitizedException))
                : String(sanitizedException);
            this.logger.error(`Unhandled Exception (${httpAdapter.getRequestUrl(ctx.getRequest())}): ${logBody}`);
        }
        else {
            // SENTINEL: Sanitize detailed messages to prevent accidental leakage of sensitive inputs
            const detailedMessage = typeof message === 'object' ? JSON.stringify(sanitize(message)) : sanitize(message);
            this.logger.warn(`HTTP Exception (${httpStatus}) [${httpAdapter.getRequestUrl(ctx.getRequest())}]: ${detailedMessage}`);
        }
        httpAdapter.reply(ctx.getResponse(), responseBody, httpStatus);
    }
};
AllExceptionsFilter = __decorate([
    Catch(),
    __metadata("design:paramtypes", [HttpAdapterHost])
], AllExceptionsFilter);
export { AllExceptionsFilter };
