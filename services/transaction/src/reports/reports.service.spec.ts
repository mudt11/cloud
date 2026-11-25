import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ReportsService, formatCsvCell } from './reports.service';
import { AccountClient } from '../transfers/account.client';
import { AuthenticatedUser } from '../common/guards/jwt-auth.guard';
import {
  ForbiddenException,
  ResourceNotFoundException,
  ValidationException,
  ExportTooLargeException,
} from '../common/exceptions/app.exception';
import { parseVietnamDateRange } from '../common/utils/date-range.util';

const CUSTOMER_USER: AuthenticatedUser = {
  sub: '11111111-1111-4111-8111-111111111111',
  role: 'CUSTOMER',
};

const ADMIN_USER: AuthenticatedUser = {
  sub: '99999999-9999-4999-8999-999999999999',
  role: 'ADMIN',
};

const ACCOUNT_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('Date Range & ReportsService (T04, T05)', () => {
  let service: ReportsService;
  let mockManager: any;
  let mockDataSource: any;
  let mockAccountClient: any;

  beforeEach(async () => {
    mockManager = {
      query: jest.fn(),
    };
    mockDataSource = {
      transaction: jest.fn(async (_isolation, cb) => cb(mockManager)),
    };
    mockAccountClient = {
      getMyAccount: jest.fn().mockResolvedValue({ id: ACCOUNT_A_ID }),
      getAdminAccountById: jest.fn().mockResolvedValue({ id: ACCOUNT_A_ID }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: AccountClient, useValue: mockAccountClient },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  describe('parseVietnamDateRange (C05)', () => {
    it('should convert 2026-10-22 VN day to [2026-10-21T17:00:00.000Z, 2026-10-22T17:00:00.000Z)', () => {
      const range = parseVietnamDateRange('2026-10-22', '2026-10-22', 31);
      expect(range.startUtc.toISOString()).toBe('2026-10-21T17:00:00.000Z');
      expect(range.endUtcExclusive.toISOString()).toBe(
        '2026-10-22T17:00:00.000Z',
      );
    });

    it('should reject invalid calendar dates like 2026-02-30', () => {
      expect(() => parseVietnamDateRange('2026-02-30', '2026-03-01')).toThrow(
        ValidationException,
      );
    });

    it('should reject when fromDate > toDate', () => {
      expect(() => parseVietnamDateRange('2026-11-10', '2026-11-01')).toThrow(
        ValidationException,
      );
    });

    it('should reject range exceeding 31 calendar days', () => {
      expect(() => parseVietnamDateRange('2026-11-01', '2026-12-02')).toThrow(
        ValidationException,
      );
    });
  });

  describe('getSummary (T04)', () => {
    const authHeader = 'Bearer jwt';
    const requestId = '77777777-7777-4777-8777-777777777777';

    it('should return ACCOUNT summary matching Document 05 R1-R5 expectations', async () => {
      mockManager.query
        .mockResolvedValueOnce(undefined) // SET TRANSACTION READ ONLY
        .mockResolvedValueOnce([
          {
            transactionCount: 3,
            incomingCount: 1,
            outgoingCount: 2,
            totalIncoming: '40000',
            totalOutgoing: '160000',
          },
        ]);

      const result = await service.getSummary(
        CUSTOMER_USER,
        { fromDate: '2026-11-01', toDate: '2026-11-02' },
        authHeader,
        requestId,
      );

      expect(result).toMatchObject({
        scope: 'ACCOUNT',
        accountId: ACCOUNT_A_ID,
        fromDate: '2026-11-01',
        toDate: '2026-11-02',
        timeZone: 'Asia/Ho_Chi_Minh',
        currency: 'VND',
        transactionCount: 3,
        incomingCount: 1,
        outgoingCount: 2,
        totalIncoming: '40000',
        totalOutgoing: '160000',
        transferVolume: null,
        consistency: 'EVENTUAL',
      });
    });

    it('should reject CUSTOMER requesting SYSTEM scope with 403 ForbiddenException', async () => {
      await expect(
        service.getSummary(
          CUSTOMER_USER,
          { fromDate: '2026-11-01', toDate: '2026-11-02', scope: 'SYSTEM' },
          authHeader,
          requestId,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject CUSTOMER passing another user accountId with 404 ResourceNotFoundException', async () => {
      await expect(
        service.getSummary(
          CUSTOMER_USER,
          {
            fromDate: '2026-11-01',
            toDate: '2026-11-02',
            accountId: ACCOUNT_B_ID,
          },
          authHeader,
          requestId,
        ),
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should return SYSTEM summary by default for ADMIN', async () => {
      mockManager.query
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([
          { transactionCount: 3, transferVolume: '200000' },
        ]);

      const result = await service.getSummary(
        ADMIN_USER,
        { fromDate: '2026-11-01', toDate: '2026-11-02' },
        authHeader,
        requestId,
      );

      expect(result).toMatchObject({
        scope: 'SYSTEM',
        accountId: null,
        transactionCount: 3,
        incomingCount: null,
        outgoingCount: null,
        totalIncoming: null,
        totalOutgoing: null,
        transferVolume: '200000',
      });
    });

    it('should reject ADMIN passing accountId with SYSTEM scope', async () => {
      await expect(
        service.getSummary(
          ADMIN_USER,
          {
            fromDate: '2026-11-01',
            toDate: '2026-11-02',
            scope: 'SYSTEM',
            accountId: ACCOUNT_A_ID,
          },
          authHeader,
          requestId,
        ),
      ).rejects.toThrow(ValidationException);
    });
  });

  describe('exportCsv (T05)', () => {
    const authHeader = 'Bearer jwt';
    const requestId = '77777777-7777-4777-8777-777777777777';

    it('should produce UTF-8 BOM + CRLF CSV and neutralize formula injection', async () => {
      mockManager.query
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          {
            id: '33333333-3333-4333-8333-333333333333',
            committedAt: new Date('2026-11-02T03:00:00.000Z'),
            fromAccountId: ACCOUNT_A_ID,
            toAccountId: ACCOUNT_B_ID,
            fromAccountNumber: '1000000001',
            toAccountNumber: '1000000002',
            amount: '100000',
            currency: 'VND',
            description: '=SUM(A1:A2) "test"',
          },
        ]);

      const csv = await service.exportCsv(
        CUSTOMER_USER,
        { fromDate: '2026-11-01', toDate: '2026-11-02' },
        authHeader,
        requestId,
      );

      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv).toContain('\r\n');
      expect(csv).toContain(
        'transferId,committedAt,fromAccountNumber,toAccountNumber,direction,amount,currency,description',
      );
      expect(csv).toContain(
        '"33333333-3333-4333-8333-333333333333","2026-11-02T03:00:00.000Z","1000000001","1000000002","OUTGOING","100000","VND","\'=SUM(A1:A2) ""test"""',
      );
    });

    it('should return BOM and header even when zero rows match', async () => {
      mockManager.query
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);

      const csv = await service.exportCsv(
        CUSTOMER_USER,
        { fromDate: '2026-11-01', toDate: '2026-11-02' },
        authHeader,
        requestId,
      );

      expect(csv).toBe(
        '\uFEFFtransferId,committedAt,fromAccountNumber,toAccountNumber,direction,amount,currency,description\r\n',
      );
    });

    it('should throw ExportTooLargeException (409) when total exceeds 10,000 rows', async () => {
      mockManager.query
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ total: 10001 }]);

      await expect(
        service.exportCsv(
          CUSTOMER_USER,
          { fromDate: '2026-11-01', toDate: '2026-11-02' },
          authHeader,
          requestId,
        ),
      ).rejects.toThrow(ExportTooLargeException);
    });

    it('should protect +, -, @, and tab formula prefixes in formatCsvCell', () => {
      expect(formatCsvCell('=1+1')).toBe('"\'=1+1"');
      expect(formatCsvCell('+cmd')).toBe('"\'+cmd"');
      expect(formatCsvCell('-123')).toBe('"\'-123"');
      expect(formatCsvCell('@SUM')).toBe('"\'@SUM"');
      expect(formatCsvCell('normal text')).toBe('"normal text"');
    });
  });
});
