import { Injectable, PipeTransform, ArgumentMetadata } from '@nestjs/common';
import { ValidationException } from '../exceptions/app.exception';
import { GENERAL_UUID_REGEX } from '../interceptors/request-id.interceptor';

/**
 * Custom pipe kiểm tra path parameter dạng UUID theo hợp đồng C03/X02:
 * trả 400 VALIDATION_ERROR kèm details [{ field, code: 'INVALID_FORMAT', message }]
 */
@Injectable()
export class ParseUuidParamPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (typeof value !== 'string' || !GENERAL_UUID_REGEX.test(value.trim())) {
      const field = metadata.data || 'id';
      throw new ValidationException(`Tham số ${field} phải là UUID hợp lệ`, [
        {
          field,
          code: 'INVALID_FORMAT',
          message: `${field} phải là UUID hợp lệ`,
        },
      ]);
    }
    return value.trim().toLowerCase();
  }
}

/**
 * Kiểm tra endpoint không cho phép query parameters theo C02/C05:
 * nếu có bất kỳ query nào -> 400 VALIDATION_ERROR với UNKNOWN_FIELD
 */
export function assertNoExtraQuery(
  query: Record<string, any> | undefined,
): void {
  if (!query) return;
  const keys = Object.keys(query);
  if (keys.length > 0) {
    throw new ValidationException(
      'Yêu cầu không hỗ trợ tham số query',
      keys.map((key) => ({
        field: `query.${key}`,
        code: 'UNKNOWN_FIELD',
        message: `Tham số query '${key}' không được hỗ trợ`,
      })),
    );
  }
}

/**
 * Chuẩn hóa chuỗi theo Unicode NFC và trim hai đầu theo C02.
 */
export function normalizeNfcTrim(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').trim();
}

/**
 * Đếm độ dài theo Unicode code point theo C02.
 */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}
