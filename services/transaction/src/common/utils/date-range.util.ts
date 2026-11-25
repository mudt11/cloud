import { ValidationException, ErrorDetail } from '../exceptions/app.exception';

const DATE_YYYY_MM_DD_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const VN_OFFSET_MS = 7 * 3600_000; // Asia/Ho_Chi_Minh = UTC+7 (không DST)
const DAY_MS = 86_400_000;

export interface UtcDateRange {
  startUtc: Date;
  endUtcExclusive: Date;
}

/**
 * Kiểm tra chuỗi YYYY-MM-DD có phải ngày lịch hợp lệ thực tế hay không (vd loại bỏ 2026-02-30).
 */
export function parseStrictCalendarDateMs(dateStr: string): number | null {
  const match = DATE_YYYY_MM_DD_REGEX.exec(dateStr);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const utcMs = Date.UTC(year, month - 1, day);
  const check = new Date(utcMs);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return utcMs;
}

/**
 * Phân tích và quy đổi khoảng ngày YYYY-MM-DD (giờ Việt Nam Asia/Ho_Chi_Minh)
 * sang khoảng UTC [startUtc, endUtcExclusive) theo Tài liệu 06 C05.
 * Kiểm tra: fromDate <= toDate và tối đa 31 ngày lịch bao gồm hai đầu.
 */
export function parseVietnamDateRange(
  fromDate: string,
  toDate: string,
  maxDays = 31,
): UtcDateRange {
  const details: ErrorDetail[] = [];

  const fromMs = parseStrictCalendarDateMs(fromDate);
  if (fromMs === null) {
    details.push({
      field: 'query.fromDate',
      code: 'INVALID_FORMAT',
      message: 'fromDate phải là ngày hợp lệ theo định dạng YYYY-MM-DD',
    });
  }

  const toMs = parseStrictCalendarDateMs(toDate);
  if (toMs === null) {
    details.push({
      field: 'query.toDate',
      code: 'INVALID_FORMAT',
      message: 'toDate phải là ngày hợp lệ theo định dạng YYYY-MM-DD',
    });
  }

  if (details.length > 0 || fromMs === null || toMs === null) {
    throw new ValidationException('Khoảng ngày lọc không hợp lệ', details);
  }

  if (fromMs > toMs) {
    throw new ValidationException('fromDate không được lớn hơn toDate', [
      {
        field: 'query.fromDate',
        code: 'OUT_OF_RANGE',
        message: 'fromDate phải nhỏ hơn hoặc bằng toDate',
      },
    ]);
  }

  const totalDays = Math.floor((toMs - fromMs) / DAY_MS) + 1;
  if (totalDays > maxDays) {
    throw new ValidationException(
      `Khoảng ngày tối đa ${maxDays} ngày lịch`,
      [
        {
          field: 'query.toDate',
          code: 'OUT_OF_RANGE',
          message: `Khoảng thời gian từ fromDate đến toDate không được vượt quá ${maxDays} ngày`,
        },
      ],
    );
  }

  return {
    startUtc: new Date(fromMs - VN_OFFSET_MS),
    endUtcExclusive: new Date(toMs + DAY_MS - VN_OFFSET_MS),
  };
}
