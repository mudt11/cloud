import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { ValidationException } from '../exceptions/app.exception';

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const GENERAL_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(id: string): boolean {
  return typeof id === 'string' && GENERAL_UUID_REGEX.test(id.trim());
}

declare module 'express' {
  interface Request {
    requestId?: string;
  }
}

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

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

    return next.handle();
  }
}
