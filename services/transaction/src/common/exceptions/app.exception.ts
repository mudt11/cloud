import { HttpException, HttpStatus } from '@nestjs/common';

export type ErrorDetailCode =
  | 'REQUIRED'
  | 'INVALID_TYPE'
  | 'INVALID_FORMAT'
  | 'OUT_OF_RANGE'
  | 'UNKNOWN_FIELD'
  | 'INVALID_VALUE'
  | (string & {});

export interface ErrorDetail {
  field: string;
  code: ErrorDetailCode;
  message: string;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: ErrorDetail[];
  };
  requestId: string;
}

export class AppException extends HttpException {
  public readonly code: string;
  public readonly details: ErrorDetail[];
  public readonly customHeaders: Record<string, string>;

  constructor(
    code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    details: ErrorDetail[] = [],
    customHeaders: Record<string, string> = {},
  ) {
    super(
      {
        code,
        message,
        details,
      },
      status,
    );
    this.code = code;
    this.details = details;
    this.customHeaders = customHeaders;
  }
}

export class ValidationException extends AppException {
  constructor(
    message = 'Dữ liệu yêu cầu không hợp lệ',
    details: ErrorDetail[] = [],
  ) {
    super('VALIDATION_ERROR', message, HttpStatus.BAD_REQUEST, details);
  }
}

export class SameAccountException extends AppException {
  constructor(message = 'Tài khoản nguồn và tài khoản đích không được trùng nhau') {
    super('SAME_ACCOUNT', message, HttpStatus.BAD_REQUEST);
  }
}

export class UnauthenticatedException extends AppException {
  constructor(message = 'Chưa được xác thực hoặc token không hợp lệ') {
    super('UNAUTHENTICATED', message, HttpStatus.UNAUTHORIZED, [], {
      'WWW-Authenticate': 'Bearer',
    });
  }
}

export class ForbiddenException extends AppException {
  constructor(message = 'Không có quyền truy cập') {
    super('FORBIDDEN', message, HttpStatus.FORBIDDEN);
  }
}

export class ResourceNotFoundException extends AppException {
  constructor(
    message = 'Tài nguyên không tồn tại',
    code = 'RESOURCE_NOT_FOUND',
  ) {
    super(code, message, HttpStatus.NOT_FOUND);
  }
}

export class IdempotencyConflictException extends AppException {
  constructor(message = 'Yêu cầu xung đột với khóa idempotency đã tồn tại') {
    super('IDEMPOTENCY_CONFLICT', message, HttpStatus.CONFLICT);
  }
}

export class ExportTooLargeException extends AppException {
  constructor(
    message = 'Số lượng giao dịch vượt quá giới hạn 10.000 dòng cho một lần xuất',
  ) {
    super('EXPORT_TOO_LARGE', message, HttpStatus.CONFLICT);
  }
}

export class PayloadTooLargeException extends AppException {
  constructor(message = 'Kích thước dữ liệu vượt quá giới hạn 16 KiB') {
    super('PAYLOAD_TOO_LARGE', message, HttpStatus.PAYLOAD_TOO_LARGE);
  }
}

export class UnsupportedMediaTypeException extends AppException {
  constructor(message = 'Content-Type phải là application/json') {
    super('UNSUPPORTED_MEDIA_TYPE', message, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
  }
}

export class RateLimitedException extends AppException {
  constructor(
    message = 'Vượt quá giới hạn tần suất yêu cầu',
    retryAfterSeconds = 1,
  ) {
    super('RATE_LIMITED', message, HttpStatus.TOO_MANY_REQUESTS, [], {
      'Retry-After': String(Math.max(1, Math.floor(retryAfterSeconds))),
    });
  }
}

export class ServiceUnavailableException extends AppException {
  constructor(
    message = 'Dịch vụ tạm thời không khả dụng',
    retryAfterSeconds = 5,
  ) {
    super('SERVICE_UNAVAILABLE', message, HttpStatus.SERVICE_UNAVAILABLE, [], {
      'Retry-After': String(retryAfterSeconds),
    });
  }
}

export class InternalErrorException extends AppException {
  constructor(message = 'Đã có lỗi xảy ra trên hệ thống') {
    super('INTERNAL_ERROR', message, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
