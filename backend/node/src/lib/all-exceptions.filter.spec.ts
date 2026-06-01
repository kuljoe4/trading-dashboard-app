import { AllExceptionsFilter } from './all-exceptions.filter';
import { HttpStatus, HttpException, Logger } from '@nestjs/common';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let mockResponse: any;
  let mockRequest: any;
  let mockArgumentsHost: any;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockRequest = {
      url: '/test-url',
      method: 'GET',
    };
    mockArgumentsHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    };
  });

  it('should handle HttpException and return sanitized response', () => {
    const exception = new HttpException('Test error', HttpStatus.BAD_REQUEST);

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      message: 'Test error',
      timestamp: expect.any(String),
      path: '/test-url',
    });
  });

  it('should handle unknown Error and return 500 Internal Server Error', () => {
    const exception = new Error('Secret internal error details');

    // Silence logger for this test
    // We access the logger through the filter instance's private field (using any)
    const loggerSpy = jest.spyOn((filter as any).logger, 'error').mockImplementation(() => {});

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockResponse.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      timestamp: expect.any(String),
      path: '/test-url',
    });

    // Check that we didn't leak "Secret internal error details"
    const jsonCall = mockResponse.json.mock.calls[0][0];
    expect(jsonCall.message).not.toContain('Secret internal error details');
    expect(loggerSpy).toHaveBeenCalled();
  });

  it('should handle validation errors correctly', () => {
    const validationMessage = ['email must be an email'];
    const exception = new HttpException(
      { message: validationMessage, error: 'Bad Request', statusCode: 400 },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      message: validationMessage,
      timestamp: expect.any(String),
      path: '/test-url',
    });
  });
});
