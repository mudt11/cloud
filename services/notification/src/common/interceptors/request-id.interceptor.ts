import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { randomUUID } from 'node:crypto';
import { ValidationException } from '../exceptions/app.exception';

export const GENERAL_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(id: string): boolean {
  return typeof id === 'string' && GENERAL_UUID_REGEX.test(id.trim());
}

declare module 'express' {
  interface Request {
    requestId?: string;
    errorCode?: string;
  }
}

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  private readonly serviceName = process.env.SERVICE_NAME || 'notification';
  private readonly appVersion = process.env.APP_VERSION || 'dev';

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const startTime = Date.now();

    const rawHeader = req.headers['x-request-id'];

    if (rawHeader !== undefined && rawHeader !== '') {
      const idString = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
      if (!isValidUuid(idString)) {
        const errorRequestId = randomUUID();
        req.requestId = errorRequestId;
        res.setHeader('X-Request-Id', errorRequestId);
        res.setHeader('Cache-Control', 'no-store');
        throw new ValidationException(
          'Header X-Request-Id không đúng định dạng UUID',
          [
            {
              field: 'x-request-id',
              code: 'INVALID_FORMAT',
              message: 'X-Request-Id phải là UUID hợp lệ',
            },
          ],
        );
      }
      req.requestId = idString.trim().toLowerCase();
    } else if (!req.requestId) {
      req.requestId = randomUUID();
    }

    res.setHeader('X-Request-Id', req.requestId);
    res.setHeader('Cache-Control', 'no-store');

    return next.handle().pipe(
      tap({
        next: () => {
          this.logAccess(req, res, startTime);
        },
      }),
    );
  }

  private logAccess(req: Request, res: Response, startTime: number): void {
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
      return;
    }

    const duration = Date.now() - startTime;
    const logEntry = {
      level: 'info',
      timestamp: new Date().toISOString(),
      service: this.serviceName,
      version: this.appVersion,
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      duration,
    };

    console.log(JSON.stringify(logEntry));
  }
}
