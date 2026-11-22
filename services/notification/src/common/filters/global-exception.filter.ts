import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppException, ErrorDetail } from '../exceptions/app.exception';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const requestId =
      req?.requestId ||
      (typeof req?.headers?.['x-request-id'] === 'string' &&
        req.headers['x-request-id']) ||
      randomUUID();

    res.setHeader('X-Request-Id', requestId);
    if (!res.getHeader('Cache-Control')) {
      res.setHeader('Cache-Control', 'no-store');
    }

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Đã có lỗi xảy ra trên hệ thống';
    let details: ErrorDetail[] = [];
    const customHeaders: Record<string, string> = {};

    if (exception instanceof AppException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details || [];
      Object.assign(customHeaders, exception.customHeaders);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resObj = exception.getResponse() as any;

      if (typeof resObj === 'object' && resObj !== null) {
        if (resObj.code) code = resObj.code;
        if (resObj.message)
          message = Array.isArray(resObj.message)
            ? resObj.message.join('; ')
            : resObj.message;
        if (Array.isArray(resObj.details)) details = resObj.details;
      } else if (typeof resObj === 'string') {
        message = resObj;
      }

      switch (status) {
        case HttpStatus.BAD_REQUEST:
          if (!code || code === 'INTERNAL_ERROR') code = 'VALIDATION_ERROR';
          break;
        case HttpStatus.UNAUTHORIZED:
          code = 'UNAUTHENTICATED';
          customHeaders['WWW-Authenticate'] = 'Bearer';
          break;
        case HttpStatus.FORBIDDEN:
          code = 'FORBIDDEN';
          break;
        case HttpStatus.NOT_FOUND:
          if (!code || code === 'INTERNAL_ERROR') code = 'RESOURCE_NOT_FOUND';
          break;
        case HttpStatus.CONFLICT:
          if (!code || code === 'INTERNAL_ERROR') code = 'IDEMPOTENCY_CONFLICT';
          break;
        case HttpStatus.PAYLOAD_TOO_LARGE:
          code = 'PAYLOAD_TOO_LARGE';
          message = 'Kích thước dữ liệu vượt quá giới hạn 16 KiB';
          break;
        case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
          code = 'UNSUPPORTED_MEDIA_TYPE';
          message = 'Content-Type phải là application/json';
          break;
        case HttpStatus.TOO_MANY_REQUESTS:
          code = 'RATE_LIMITED';
          break;
        case HttpStatus.SERVICE_UNAVAILABLE:
          code = 'SERVICE_UNAVAILABLE';
          if (!customHeaders['Retry-After']) {
            customHeaders['Retry-After'] = '5';
          }
          break;
        default:
          if (status >= 500) {
            code = 'INTERNAL_ERROR';
            message = 'Đã có lỗi xảy ra trên hệ thống';
          }
      }
    } else {
      // Unhandled / raw errors
      const err = exception as any;
      if (err?.type === 'entity.too.large' || err?.status === 413) {
        status = HttpStatus.PAYLOAD_TOO_LARGE;
        code = 'PAYLOAD_TOO_LARGE';
        message = 'Kích thước dữ liệu vượt quá giới hạn 16 KiB';
      } else if (err instanceof SyntaxError && 'body' in err) {
        status = HttpStatus.BAD_REQUEST;
        code = 'VALIDATION_ERROR';
        message = 'Dữ liệu JSON không đúng cú pháp';
      } else {
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        code = 'INTERNAL_ERROR';
        message = 'Đã có lỗi xảy ra trên hệ thống';
        // Never output stack traces or SQL to response, only log server-side
        this.logger.error(
          `[${requestId}] Unhandled Exception: ${err?.message || exception}`,
          err?.stack,
        );
      }
    }

    for (const [k, v] of Object.entries(customHeaders)) {
      res.setHeader(k, v);
    }

    res.status(status).json({
      error: {
        code,
        message,
        details,
      },
      requestId,
    });
  }
}
