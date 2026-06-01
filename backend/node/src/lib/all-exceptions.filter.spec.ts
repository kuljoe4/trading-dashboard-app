import { AllExceptionsFilter } from './all-exceptions.filter';
import { HttpStatus, HttpException } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let mockHttpAdapter: any;
  let mockHttpAdapterHost: HttpAdapterHost;
  let mockArgumentsHost: any;
  let mockResponse: any;

  beforeEach(() => {
    mockHttpAdapter = {
      getRequestUrl: jest.fn().mockReturnValue('/test-url'),
      reply: jest.fn(),
    };
    mockHttpAdapterHost = {
      httpAdapter: mockHttpAdapter,
    } as unknown as HttpAdapterHost;

    filter = new AllExceptionsFilter(mockHttpAdapterHost);

    mockResponse = {};
    mockArgumentsHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => mockResponse,
        getRequest: () => ({ url: '/test-url', method: 'GET' }),
      }),
    };
  });

  it('should handle HttpException and return sanitized response', () => {
    const exception = new HttpException('Test error', HttpStatus.BAD_REQUEST);

    filter.catch(exception, mockArgumentsHost);

    expect(mockHttpAdapter.reply).toHaveBeenCalledWith(
      mockResponse,
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Test error',
        path: '/test-url',
      }),
      HttpStatus.BAD_REQUEST
    );
  });

  it('should handle unknown Error and return 500 Internal Server Error', () => {
    const exception = new Error('Secret internal error details');

    // Silence logger for this test
    const loggerSpy = jest.spyOn((filter as any).logger, 'error').mockImplementation(() => {});

    filter.catch(exception, mockArgumentsHost);

    expect(mockHttpAdapter.reply).toHaveBeenCalledWith(
      mockResponse,
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
        path: '/test-url',
      }),
      HttpStatus.INTERNAL_SERVER_ERROR
    );

    // Check that we didn't leak "Secret internal error details"
    const replyCall = mockHttpAdapter.reply.mock.calls[0][1];
    expect(replyCall.message).not.toContain('Secret internal error details');
    expect(loggerSpy).toHaveBeenCalled();
  });

  it('should handle validation errors correctly', () => {
    const validationMessage = ['email must be an email'];
    const exception = new HttpException(
      { message: validationMessage, error: 'Bad Request', statusCode: 400 },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, mockArgumentsHost);

    expect(mockHttpAdapter.reply).toHaveBeenCalledWith(
      mockResponse,
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: validationMessage,
        path: '/test-url',
      }),
      HttpStatus.BAD_REQUEST
    );
  });
});
