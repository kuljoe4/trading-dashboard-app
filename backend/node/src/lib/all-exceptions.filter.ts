import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { MomentumException } from './exceptions';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;

    const ctx = host.switchToHttp();

    const httpStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: any = 'Internal server error';
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      message = (typeof response === 'object' && (response as any).message) ? (response as any).message : exception.message;
    } else if (exception instanceof Error) {
        message = 'Internal server error';
    }

    const responseBody: any = {
      statusCode: httpStatus,
      timestamp: new Date().toISOString(),
      path: httpAdapter.getRequestUrl(ctx.getRequest()),
      // SENTINEL: Prevent sensitive data leakage by forcing a generic message for 5xx errors
      message: httpStatus >= 500 ? 'Internal server error' : message,
    };

    if (exception instanceof MomentumException) {
      responseBody.code = exception.code;
    }

    // Audit Item 33: Log full stack trace for unhandled exceptions
    if (httpStatus >= 500) {
      this.logger.error(`Unhandled Exception (${httpAdapter.getRequestUrl(ctx.getRequest())}): ${(exception as any)?.stack || exception}`);
    } else {
      // SENTINEL: Recursively sanitize the message object to remove potentially sensitive 'value' fields from validation errors
      const sanitize = (obj: any): any => {
        if (Array.isArray(obj)) return obj.map(sanitize);
        if (obj !== null && typeof obj === 'object') {
          const newObj: any = {};
          for (const key in obj) {
            // Remove 'value' if it seems to be part of a class-validator ValidationError
            if (key === 'value' && (obj.property !== undefined || obj.constraints !== undefined)) {
              continue;
            }
            newObj[key] = sanitize(obj[key]);
          }
          return newObj;
        }
        return obj;
      };

      const detailedMessage = typeof message === 'object' ? JSON.stringify(sanitize(message)) : message;
      this.logger.warn(`HTTP Exception (${httpStatus}) [${httpAdapter.getRequestUrl(ctx.getRequest())}]: ${detailedMessage}`);
    }

    httpAdapter.reply(ctx.getResponse(), responseBody, httpStatus);
  }
}
