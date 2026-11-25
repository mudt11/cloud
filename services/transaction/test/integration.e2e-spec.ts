import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Module } from '@nestjs/common';
import { json, urlencoded } from 'express';
import * as http from 'node:http';
import request from 'supertest';
import { App } from 'supertest/types';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { AppModule } from './../src/app.module';
import { DatabaseModule } from '../src/database/database.module';
import { TransfersModule } from '../src/transfers/transfers.module';
import { ReportsModule } from '../src/reports/reports.module';
import { RabbitMqModule } from '../src/rabbitmq/rabbitmq.module';
import { TransferController } from '../src/transfers/transfer.controller';
import { TransferService } from '../src/transfers/transfer.service';
import { ReportsController } from '../src/reports/reports.controller';
import { ReportsService } from '../src/reports/reports.service';
import { RequestIdInterceptor } from '../src/common/interceptors/request-id.interceptor';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe';
import { contentTypeJsonMiddleware } from '../src/common/middleware/content-type.middleware';
import {
  ExportTooLargeException,
  ResourceNotFoundException,
} from '../src/common/exceptions/app.exception';

@Module({})
class MockDatabaseModule {}

@Module({})
class MockRabbitMqModule {}

const CUSTOMER_SUB = '11111111-1111-4111-8111-111111111111';
const ADMIN_SUB = '99999999-9999-4999-8999-999999999999';
const IDEMPOTENCY_KEY = '66666666-6666-4666-8666-666666666666';

const MOCK_TRANSFER = {
  id: '33333333-3333-4333-8333-333333333333',
  requesterUserId: CUSTOMER_SUB,
  fromAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  toAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  fromAccountNumber: '1000000001',
  toAccountNumber: '1000000002',
  amount: '100000',
  currency: 'VND',
  description: 'Chuyen tien',
  status: 'SUCCEEDED',
  reasonCode: null,
  createdAt: '2026-11-02T03:00:00.000Z',
  updatedAt: '2026-11-02T03:00:00.000Z',
  committedAt: '2026-11-02T03:00:00.000Z',
};

const mockTransferService = {
  create: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
};

const mockReportsService = {
  getSummary: jest.fn(),
  exportCsv: jest.fn(),
};

@Module({
  controllers: [TransferController],
  providers: [{ provide: TransferService, useValue: mockTransferService }],
  exports: [TransferService],
})
class MockTransfersModule {}

@Module({
  controllers: [ReportsController],
  providers: [{ provide: ReportsService, useValue: mockReportsService }],
})
class MockReportsModule {}

describe('Transaction Service Full HTTP Integration Tests (C02–C05, T01–T05)', () => {
  let app: INestApplication<App>;
  let jwksServer: http.Server;
  let customerToken: string;
  let adminToken: string;
  let rateLimitTestToken: string;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(publicKey);
    publicJwk.use = 'sig';
    publicJwk.alg = 'RS256';
    publicJwk.kid = 'test-key-1';

    jwksServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [publicJwk] }));
    });
    await new Promise<void>((resolve) => {
      jwksServer.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = jwksServer.address() as { port: number };
    process.env.JWT_JWKS_URL = `http://127.0.0.1:${addr.port}/api/v1/auth/jwks`;
    process.env.JWT_ISSUER = 'mini-bank-user';
    process.env.JWT_AUDIENCE = 'mini-bank-api';

    const signToken = (sub: string, role: 'CUSTOMER' | 'ADMIN', name: string) =>
      new SignJWT({ role, name, jti: '77777777-7777-4777-8777-777777777777' })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
        .setSubject(sub)
        .setIssuer('mini-bank-user')
        .setAudience('mini-bank-api')
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(privateKey);

    customerToken = await signToken(CUSTOMER_SUB, 'CUSTOMER', 'Nguyen Van A');
    adminToken = await signToken(ADMIN_SUB, 'ADMIN', 'Admin User');
    rateLimitTestToken = await signToken(
      '88888888-8888-4888-8888-888888888888',
      'CUSTOMER',
      'Rate Limit Tester',
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideModule(DatabaseModule)
      .useModule(MockDatabaseModule)
      .overrideModule(TransfersModule)
      .useModule(MockTransfersModule)
      .overrideModule(ReportsModule)
      .useModule(MockReportsModule)
      .overrideModule(RabbitMqModule)
      .useModule(MockRabbitMqModule)
      .compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    app.use(contentTypeJsonMiddleware);
    app.use(json({ limit: '16kb' }));
    app.use(urlencoded({ extended: true, limit: '16kb' }));
    app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
    app.useGlobalInterceptors(new RequestIdInterceptor());
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalPipes(createGlobalValidationPipe());

    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Transport & Guards (C02, C03, C04)', () => {
    it('415 UNSUPPORTED_MEDIA_TYPE when POST body is not application/json', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Content-Type', 'text/plain')
        .send('hello')
        .expect(415);

      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('413 PAYLOAD_TOO_LARGE when JSON body exceeds 16 KiB', async () => {
      const largeBody = { description: 'a'.repeat(20_000) };
      const res = await request(app.getHttpServer())
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Content-Type', 'application/json')
        .send(largeBody)
        .expect(413);

      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('401 UNAUTHENTICATED without token + WWW-Authenticate: Bearer', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/transfers')
        .expect(401);

      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.headers['www-authenticate']).toBe('Bearer');
    });

    it('403 FORBIDDEN when ADMIN tries to create transfer (T01)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', IDEMPOTENCY_KEY)
        .send({
          fromAccountId: MOCK_TRANSFER.fromAccountId,
          toAccountNumber: '1000000002',
          amount: '100000',
        })
        .expect(403);

      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('T01 — POST /api/v1/transfers', () => {
    const validBody = {
      fromAccountId: MOCK_TRANSFER.fromAccountId,
      toAccountNumber: '1000000002',
      amount: '100000',
      description: 'Chuyen tien',
    };

    it('201 Created with Location & Idempotency-Replayed: false', async () => {
      mockTransferService.create.mockResolvedValue({
        transfer: MOCK_TRANSFER,
        replayed: false,
        pending: false,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', IDEMPOTENCY_KEY)
        .send(validBody)
        .expect(201);

      expect(res.headers['idempotency-replayed']).toBe('false');
      expect(res.headers['location']).toBe(
        `/api/v1/transfers/${MOCK_TRANSFER.id}`,
      );
      expect(res.body.data.id).toBe(MOCK_TRANSFER.id);
    });

    it('202 Accepted with Location & Retry-After: 2 when PENDING', async () => {
      mockTransferService.create.mockResolvedValue({
        transfer: { ...MOCK_TRANSFER, status: 'PENDING', committedAt: null },
        replayed: false,
        pending: true,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', IDEMPOTENCY_KEY)
        .send(validBody)
        .expect(202);

      expect(res.headers['retry-after']).toBe('2');
      expect(res.headers['location']).toBe(
        `/api/v1/transfers/${MOCK_TRANSFER.id}`,
      );
    });

    it('400 VALIDATION_ERROR on unknown field or invalid amount (> 1B or number)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', IDEMPOTENCY_KEY)
        .send({
          ...validBody,
          amount: '1000000001',
          userId: 'hacker-id',
        })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      const codes = res.body.error.details.map((d: any) => d.code);
      expect(codes).toContain('UNKNOWN_FIELD');
      expect(codes).toContain('OUT_OF_RANGE');
    });
  });

  describe('T02 & T03 — History & Detail', () => {
    it('T02 GET /api/v1/transfers returns C05 meta envelope', async () => {
      mockTransferService.findAll.mockResolvedValue({
        items: [MOCK_TRANSFER],
        meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/transfers?page=1&pageSize=20')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);

      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.meta.totalPages).toBe(1);
    });

    it('T02 rejects unknown query parameter with 400 UNKNOWN_FIELD', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/transfers?limit=10')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].code).toBe('UNKNOWN_FIELD');
    });

    it('T03 returns 404 RESOURCE_NOT_FOUND when transfer does not exist or unauthorized', async () => {
      mockTransferService.findOne.mockRejectedValue(
        new ResourceNotFoundException('Giao dịch không tồn tại'),
      );

      const res = await request(app.getHttpServer())
        .get(`/api/v1/transfers/${MOCK_TRANSFER.id}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(404);

      expect(res.body.error.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('T03 returns 400 INVALID_FORMAT when transferId param is not UUID', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/transfers/invalid-uuid')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].code).toBe('INVALID_FORMAT');
    });
  });

  describe('T04 & T05 — Reports Summary, CSV Export & Rate Limit', () => {
    it('T04 GET /api/v1/reports/summary returns 200', async () => {
      mockReportsService.getSummary.mockResolvedValue({
        scope: 'SYSTEM',
        accountId: null,
        fromDate: '2026-11-01',
        toDate: '2026-11-02',
        timeZone: 'Asia/Ho_Chi_Minh',
        currency: 'VND',
        transactionCount: 3,
        incomingCount: null,
        outgoingCount: null,
        totalIncoming: null,
        totalOutgoing: null,
        transferVolume: '200000',
        generatedAt: '2026-11-02T03:00:00.000Z',
        consistency: 'EVENTUAL',
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/summary?fromDate=2026-11-01&toDate=2026-11-02')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.transferVolume).toBe('200000');
    });

    it('T05 GET /api/v1/reports/export streams CSV with UTF-8 BOM and Content-Disposition', async () => {
      mockReportsService.exportCsv.mockResolvedValue(
        '\uFEFFtransferId,committedAt,fromAccountNumber,toAccountNumber,direction,amount,currency,description\r\n',
      );

      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/export?fromDate=2026-11-01&toDate=2026-11-02')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);

      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="transactions-2026-11-01-2026-11-02.csv"',
      );
      expect(res.text.startsWith('\uFEFF')).toBe(true);
    });

    it('T05 returns 409 EXPORT_TOO_LARGE JSON when > 10,000 rows', async () => {
      mockReportsService.exportCsv.mockRejectedValue(
        new ExportTooLargeException(),
      );

      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/export?fromDate=2026-11-01&toDate=2026-11-02')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(409);

      expect(res.body.error.code).toBe('EXPORT_TOO_LARGE');
    });

    it('T05 enforces rate limit (5 req / 60s per sub) with 429 RATE_LIMITED and Retry-After', async () => {
      mockReportsService.exportCsv.mockResolvedValue(
        '\uFEFFtransferId,committedAt,fromAccountNumber,toAccountNumber,direction,amount,currency,description\r\n',
      );

      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .get('/api/v1/reports/export?fromDate=2026-11-01&toDate=2026-11-02')
          .set('Authorization', `Bearer ${rateLimitTestToken}`)
          .expect(200);
      }

      const limited = await request(app.getHttpServer())
        .get('/api/v1/reports/export?fromDate=2026-11-01&toDate=2026-11-02')
        .set('Authorization', `Bearer ${rateLimitTestToken}`)
        .expect(429);

      expect(limited.body.error.code).toBe('RATE_LIMITED');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    });
  });
});
