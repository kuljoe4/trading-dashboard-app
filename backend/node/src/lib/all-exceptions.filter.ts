import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * SENTINEL: Global exception filter to catch all unhandled exceptions.
 * Prevents information disclosure by sanitizing error responses and
 * ensuring stack traces are never leaked to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('AllExceptionsFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException
        ? exception.getResponse()
        : null;

    // Log the full exception details internally for debugging
    const errorMessage = exception instanceof Error ? exception.message : String(exception);
    const logMessage = `[${request.method}] ${request.url} - Status: ${status} - Error: ${errorMessage}`;

    if (status >= 500) {
      this.logger.error(logMessage, exception instanceof Error ? exception.stack : undefined);
    } else {
      this.logger.warn(logMessage);
    }

    // Construct a sanitized response
    // If it's a known HttpException, we try to preserve the message (e.g. validation errors)
    // but we wrap it in a standard structure.
    let message = 'Internal server error';

    if (status < 500 && exceptionResponse) {
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && (exceptionResponse as any).message) {
        message = (exceptionResponse as any).message;
      }
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
