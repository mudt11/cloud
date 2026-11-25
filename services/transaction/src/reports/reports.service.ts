import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AccountClient } from '../transfers/account.client';
import { AuthenticatedUser } from '../common/guards/jwt-auth.guard';
import {
  ReportSummaryQueryDto,
  ReportExportQueryDto,
  ReportSummaryDto,
} from './dto/report.dto';
import {
  ForbiddenException,
  ResourceNotFoundException,
  ValidationException,
  ExportTooLargeException,
} from '../common/exceptions/app.exception';
import { parseVietnamDateRange } from '../common/utils/date-range.util';

const EXPORT_MAX_ROWS = 10_000;

interface ResolvedScope {
  scope: 'ACCOUNT' | 'SYSTEM';
  accountId: string | null;
}

interface ExportRow {
  id: string;
  committedAt: Date;
  fromAccountId: string;
  toAccountId: string;
  fromAccountNumber: string;
  toAccountNumber: string;
  amount: string;
  currency: string;
  description: string;
}

/**
 * Chuẩn hóa một ô CSV theo RFC 4180 + chống CSV formula injection (Tài liệu 06 T05):
 * - Nếu bắt đầu bằng =, +, -, @, \t, \r hoặc ký tự điều khiển thì thêm ' ở đầu trước khi escape.
 * - Escape dấu " thành "" và luôn bọc trong "...".
 */
export function formatCsvCell(value: string, protectFormula = true): string {
  let safe = value ?? '';
  if (protectFormula && safe.length > 0) {
    const firstChar = safe[0];
    const firstCode = safe.charCodeAt(0);
    if (
      firstChar === '=' ||
      firstChar === '+' ||
      firstChar === '-' ||
      firstChar === '@' ||
      firstCode <= 0x1f ||
      firstCode === 0x7f
    ) {
      safe = `'${safe}`;
    }
  }
  return `"${safe.replace(/"/g, '""')}"`;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly accountClient: AccountClient,
  ) {}

  /**
   * Kiểm tra quyền và xác định scope + accountId hiệu lực theo T04 / T05.
   */
  private async resolveScopeAndAccount(
    user: AuthenticatedUser,
    query: ReportSummaryQueryDto,
    authorizationHeader: string,
    requestId: string,
  ): Promise<ResolvedScope> {
    if (user.role === 'CUSTOMER') {
      if (query.scope === 'SYSTEM') {
        throw new ForbiddenException(
          'Khách hàng không có quyền xem báo cáo toàn hệ thống',
        );
      }

      const myAccount = await this.accountClient.getMyAccount(
        authorizationHeader,
        requestId,
      );

      if (
        query.accountId &&
        query.accountId.trim().toLowerCase() !== myAccount.id.toLowerCase()
      ) {
        throw new ResourceNotFoundException(
          'Tài khoản không tồn tại hoặc không thuộc quyền',
          'ACCOUNT_NOT_FOUND',
        );
      }

      return { scope: 'ACCOUNT', accountId: myAccount.id };
    }

    // ADMIN
    const effectiveScope = query.scope ?? 'SYSTEM';
    if (effectiveScope === 'SYSTEM') {
      if (query.accountId) {
        throw new ValidationException(
          'Không được truyền accountId khi scope là SYSTEM',
          [
            {
              field: 'query.accountId',
              code: 'UNKNOWN_FIELD',
              message: 'scope=SYSTEM không nhận accountId',
            },
          ],
        );
      }
      return { scope: 'SYSTEM', accountId: null };
    }

    // ADMIN với scope=ACCOUNT
    if (!query.accountId) {
      throw new ValidationException(
        'accountId là bắt buộc khi ADMIN xem báo cáo ACCOUNT',
        [
          {
            field: 'query.accountId',
            code: 'REQUIRED',
            message: 'Phải truyền accountId khi scope=ACCOUNT',
          },
        ],
      );
    }

    const normalizedAccountId = query.accountId.trim().toLowerCase();
    await this.accountClient.getAdminAccountById(
      authorizationHeader,
      normalizedAccountId,
      requestId,
    );

    return { scope: 'ACCOUNT', accountId: normalizedAccountId };
  }

  /**
   * T04 — GET /api/v1/reports/summary
   * Chỉ tính SUCCEEDED theo committedAt trong snapshot đọc nhất quán.
   */
  async getSummary(
    user: AuthenticatedUser,
    query: ReportSummaryQueryDto,
    authorizationHeader: string,
    requestId: string,
  ): Promise<ReportSummaryDto> {
    const { startUtc, endUtcExclusive } = parseVietnamDateRange(
      query.fromDate,
      query.toDate,
      31,
    );

    const resolved = await this.resolveScopeAndAccount(
      user,
      query,
      authorizationHeader,
      requestId,
    );

    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');

      if (resolved.scope === 'ACCOUNT') {
        const rows = (await manager.query(
          `
          SELECT
            COUNT(*)::int AS "transactionCount",
            COUNT(*) FILTER (WHERE to_account_id = $1)::int AS "incomingCount",
            COUNT(*) FILTER (WHERE from_account_id = $1)::int AS "outgoingCount",
            COALESCE(SUM(amount) FILTER (WHERE to_account_id = $1), 0)::text AS "totalIncoming",
            COALESCE(SUM(amount) FILTER (WHERE from_account_id = $1), 0)::text AS "totalOutgoing"
          FROM transfers
          WHERE status = 'SUCCEEDED'
            AND committed_at >= $2
            AND committed_at < $3
            AND (from_account_id = $1 OR to_account_id = $1)
          `,
          [resolved.accountId, startUtc, endUtcExclusive],
        )) as Array<{
          transactionCount: number;
          incomingCount: number;
          outgoingCount: number;
          totalIncoming: string;
          totalOutgoing: string;
        }>;

        const row = rows[0] ?? {
          transactionCount: 0,
          incomingCount: 0,
          outgoingCount: 0,
          totalIncoming: '0',
          totalOutgoing: '0',
        };

        return {
          scope: 'ACCOUNT',
          accountId: resolved.accountId,
          fromDate: query.fromDate,
          toDate: query.toDate,
          timeZone: 'Asia/Ho_Chi_Minh',
          currency: 'VND',
          transactionCount: Number(row.transactionCount),
          incomingCount: Number(row.incomingCount),
          outgoingCount: Number(row.outgoingCount),
          totalIncoming: String(row.totalIncoming),
          totalOutgoing: String(row.totalOutgoing),
          transferVolume: null,
          generatedAt: new Date().toISOString(),
          consistency: 'EVENTUAL',
        };
      }

      // SYSTEM scope
      const rows = (await manager.query(
        `
        SELECT
          COUNT(*)::int AS "transactionCount",
          COALESCE(SUM(amount), 0)::text AS "transferVolume"
        FROM transfers
        WHERE status = 'SUCCEEDED'
          AND committed_at >= $1
          AND committed_at < $2
        `,
        [startUtc, endUtcExclusive],
      )) as Array<{
        transactionCount: number;
        transferVolume: string;
      }>;

      const row = rows[0] ?? { transactionCount: 0, transferVolume: '0' };

      return {
        scope: 'SYSTEM',
        accountId: null,
        fromDate: query.fromDate,
        toDate: query.toDate,
        timeZone: 'Asia/Ho_Chi_Minh',
        currency: 'VND',
        transactionCount: Number(row.transactionCount),
        incomingCount: null,
        outgoingCount: null,
        totalIncoming: null,
        totalOutgoing: null,
        transferVolume: String(row.transferVolume),
        generatedAt: new Date().toISOString(),
        consistency: 'EVENTUAL',
      };
    });
  }

  /**
   * T05 — GET /api/v1/reports/export
   * Xuất CSV UTF-8 BOM, CRLF, tối đa 10.000 dòng (vượt trả 409 EXPORT_TOO_LARGE).
   */
  async exportCsv(
    user: AuthenticatedUser,
    query: ReportExportQueryDto,
    authorizationHeader: string,
    requestId: string,
  ): Promise<string> {
    const { startUtc, endUtcExclusive } = parseVietnamDateRange(
      query.fromDate,
      query.toDate,
      31,
    );

    const resolved = await this.resolveScopeAndAccount(
      user,
      query,
      authorizationHeader,
      requestId,
    );

    if (resolved.scope === 'SYSTEM' && query.direction) {
      throw new ValidationException(
        'direction chỉ hợp lệ khi scope là ACCOUNT',
        [
          {
            field: 'query.direction',
            code: 'UNKNOWN_FIELD',
            message: 'scope=SYSTEM không hỗ trợ lọc direction',
          },
        ],
      );
    }

    const rows = await this.dataSource.transaction(
      'REPEATABLE READ',
      async (manager) => {
        await manager.query('SET TRANSACTION READ ONLY');

        const conditions: string[] = [
          `status = 'SUCCEEDED'`,
          `committed_at >= $1`,
          `committed_at < $2`,
        ];
        const params: any[] = [startUtc, endUtcExclusive];

        if (resolved.scope === 'ACCOUNT') {
          params.push(resolved.accountId);
          const idx = `$${params.length}`;
          if (query.direction === 'INCOMING') {
            conditions.push(`to_account_id = ${idx}`);
          } else if (query.direction === 'OUTGOING') {
            conditions.push(`from_account_id = ${idx}`);
          } else {
            conditions.push(`(from_account_id = ${idx} OR to_account_id = ${idx})`);
          }
        }

        const whereClause = conditions.join(' AND ');

        const countRes = (await manager.query(
          `SELECT COUNT(*)::int AS "total" FROM transfers WHERE ${whereClause}`,
          params,
        )) as Array<{ total: number }>;

        const totalRows = Number(countRes[0]?.total ?? 0);
        if (totalRows > EXPORT_MAX_ROWS) {
          throw new ExportTooLargeException();
        }

        return (await manager.query(
          `
          SELECT
            id,
            committed_at AS "committedAt",
            from_account_id AS "fromAccountId",
            to_account_id AS "toAccountId",
            from_account_number AS "fromAccountNumber",
            to_account_number AS "toAccountNumber",
            amount::text AS "amount",
            currency,
            description
          FROM transfers
          WHERE ${whereClause}
          ORDER BY committed_at ASC, id ASC
          `,
          params,
        )) as ExportRow[];
      },
    );

    return this.buildCsvContent(rows, resolved);
  }

  buildCsvContent(rows: ExportRow[], resolved: ResolvedScope): string {
    const header =
      'transferId,committedAt,fromAccountNumber,toAccountNumber,direction,amount,currency,description';

    const lines = rows.map((row) => {
      const direction =
        resolved.scope === 'SYSTEM'
          ? 'INTERNAL'
          : row.fromAccountId.toLowerCase() ===
              resolved.accountId?.toLowerCase()
            ? 'OUTGOING'
            : 'INCOMING';

      const committedIso =
        row.committedAt instanceof Date
          ? row.committedAt.toISOString()
          : new Date(row.committedAt).toISOString();

      return [
        formatCsvCell(row.id, false),
        formatCsvCell(committedIso, false),
        formatCsvCell(row.fromAccountNumber, false),
        formatCsvCell(row.toAccountNumber, false),
        formatCsvCell(direction, false),
        formatCsvCell(String(row.amount), false),
        formatCsvCell(row.currency, false),
        formatCsvCell(row.description ?? '', true),
      ].join(',');
    });

    // UTF-8 BOM + CRLF theo Tài liệu 06 T05
    return `\uFEFF${[header, ...lines].join('\r\n')}\r\n`;
  }
}
