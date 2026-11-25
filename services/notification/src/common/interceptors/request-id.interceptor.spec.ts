import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { RequestIdInterceptor, isValidUuid } from './request-id.interceptor';
import { ValidationException } from '../exceptions/app.exception';

describe('RequestIdInterceptor', () => {
  let interceptor: RequestIdInterceptor;

  beforeEach(() => {
    interceptor = new RequestIdInterceptor();
  });

  function createMockContext(headers: Record<string, string | undefined>) {
    const req: any = { headers: { ...headers } };
    const resHeaders: Record<string, string> = {};
    const res: any = {
      setHeader: jest.fn((k: string, v: string) => {
        resHeaders[k.toLowerCase()] = v;
      }),
      getHeader: jest.fn((k: string) => resHeaders[k.toLowerCase()]),
    };

    const ctx = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;

    const next: CallHandler = {
      handle: () => of('test-response'),
    };

    return { ctx, req, res, resHeaders, next };
  }

  it('should generate a valid UUID when X-Request-Id header is missing', (done) => {
    const { ctx, req, res, next } = createMockContext({});

    interceptor.intercept(ctx, next).subscribe({
      next: (val) => {
        expect(val).toBe('test-response');
        expect(req.requestId).toBeDefined();
        expect(isValidUuid(req.requestId!)).toBe(true);
        expect(res.setHeader).toHaveBeenCalledWith(
          'X-Request-Id',
          req.requestId,
        );
        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
        done();
      },
    });
  });

  it('should keep and use incoming X-Request-Id when valid UUID', (done) => {
    const validUuid = '77777777-7777-4777-8777-777777777777';
    const { ctx, req, res, next } = createMockContext({
      'x-request-id': validUuid,
    });

    interceptor.intercept(ctx, next).subscribe({
      next: (val) => {
        expect(val).toBe('test-response');
        expect(req.requestId).toBe(validUuid);
        expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', validUuid);
        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
        done();
      },
    });
  });

  it('should throw ValidationException (400) when X-Request-Id is not a valid UUID', () => {
    const invalidUuid = 'not-a-valid-uuid-123';
    const { ctx, req, res, next } = createMockContext({
      'x-request-id': invalidUuid,
    });

    expect(() => interceptor.intercept(ctx, next)).toThrow(ValidationException);
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      expect.any(String),
    );
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(isValidUuid(req.requestId!)).toBe(true);
  });
});
