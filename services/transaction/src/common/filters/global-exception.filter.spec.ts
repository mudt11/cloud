import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';
import {
  ValidationException,
  UnauthenticatedException,
  ServiceUnavailableException,
} from '../exceptions/app.exception';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
  });

  function createMockHost(requestId = '11111111-2222-3333-4444-555555555555') {
    const req: any = { requestId, headers: {} };
    let capturedStatus: number | null = null;
    let capturedJson: any = null;
    const responseHeaders: Record<string, string> = {};

    const res: any = {
      status: jest.fn((code: number) => {
        capturedStatus = code;
        return res;
      }),
      json: jest.fn((body: any) => {
        capturedJson = body;
        return res;
      }),
      setHeader: jest.fn((k: string, v: string) => {
        responseHeaders[k.toLowerCase()] = v;
      }),
      getHeader: jest.fn((k: string) => responseHeaders[k.toLowerCase()]),
    };

    const host = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ArgumentsHost;

    return {
      host,
      req,
      res,
      responseHeaders,
      getStatus: () => capturedStatus,
      getJson: () => capturedJson,
    };
  }

  it('should format ValidationException with C03 envelope', () => {
    const { host, getStatus, getJson, responseHeaders } = createMockHost();
    const details = [
      {
        field: 'amount',
        code: 'INVALID_FORMAT',
        message: 'Số tiền phải là chuỗi số nguyên dương',
      },
    ];
    const ex = new ValidationException('Dữ liệu yêu cầu không hợp lệ', details);

    filter.catch(ex, host);

    expect(getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(responseHeaders['x-request-id']).toBe(
      '11111111-2222-3333-4444-555555555555',
    );
    expect(responseHeaders['cache-control']).toBe('no-store');

    const json = getJson();
    expect(json).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Dữ liệu yêu cầu không hợp lệ',
        details,
      },
      requestId: '11111111-2222-3333-4444-555555555555',
    });
  });

  it('should format UnauthenticatedException (401) with WWW-Authenticate header', () => {
    const { host, getStatus, getJson, responseHeaders } = createMockHost();
    const ex = new UnauthenticatedException(
      'Access token không hợp lệ hoặc đã hết hạn',
    );

    filter.catch(ex, host);

    expect(getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(responseHeaders['www-authenticate']).toBe('Bearer');
    expect(getJson().error.code).toBe('UNAUTHENTICATED');
  });

  it('should format ServiceUnavailableException (503) with Retry-After: 5', () => {
    const { host, getStatus, getJson, responseHeaders } = createMockHost();
    const ex = new ServiceUnavailableException(
      'Dịch vụ xác thực tạm thời không khả dụng',
    );

    filter.catch(ex, host);

    expect(getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(responseHeaders['retry-after']).toBe('5');
    expect(getJson().error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('should format unhandled error without leaking internal stack trace or SQL', () => {
    const { host, getStatus, getJson } = createMockHost();
    const rawError = new Error(
      'SELECT * FROM users WHERE password = secret; Connection refused',
    );

    filter.catch(rawError, host);

    expect(getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    const json = getJson();
    expect(json.error.code).toBe('INTERNAL_ERROR');
    expect(json.error.message).toBe('Đã có lỗi xảy ra trên hệ thống');
    expect(json.error.details).toEqual([]);
    expect(JSON.stringify(json)).not.toContain('SELECT');
    expect(JSON.stringify(json)).not.toContain('secret');
  });

  it('should handle Express 413 PayloadTooLargeError', () => {
    const { host, getStatus, getJson } = createMockHost();
    const payloadError = {
      type: 'entity.too.large',
      status: 413,
      message: 'request entity too large',
    };

    filter.catch(payloadError, host);

    expect(getStatus()).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(getJson().error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(getJson().error.message).toBe(
      'Kích thước dữ liệu vượt quá giới hạn 16 KiB',
    );
  });
});
