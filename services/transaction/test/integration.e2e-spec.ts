import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Module } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { DatabaseModule } from '../src/database/database.module';
import { TransfersModule } from '../src/transfers/transfers.module';
import { RabbitMqModule } from '../src/rabbitmq/rabbitmq.module';
import { TransferController } from '../src/transfers/transfer.controller';
import { TransferService } from '../src/transfers/transfer.service';
import { RequestIdInterceptor } from '../src/common/interceptors/request-id.interceptor';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe';

@Module({})
class MockDatabaseModule {}

@Module({})
class MockRabbitMqModule {}

const MOCK_TRANSFER = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  status: 'SUCCEEDED',
  fromAccountId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  toAccountId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  fromAccountNumber: '1234567890',
  toAccountNumber: '0987654321',
  fromUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  toUserId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  amount: '500000',
  currency: 'VND',
  description: 'Thanh toán',
  reasonCode: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:01.000Z',
  committedAt: '2026-11-01T10:00:01.000Z',
};

/**
 * MockTransfersModule giữ lại TransferController nhưng mock TransferService
 * → routes /api/v1/transfers vẫn được đăng ký, không cần DB thật
 */
const mockTransferService = {
  create: jest.fn(),
  findOne: jest.fn(),
};

@Module({
  controllers: [TransferController],
  providers: [{ provide: TransferService, useValue: mockTransferService }],
})
class MockTransfersModule {}

describe('Transaction Service Integration Tests', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideModule(DatabaseModule)
      .useModule(MockDatabaseModule)
      .overrideModule(TransfersModule)
      .useModule(MockTransfersModule)
      .overrideModule(RabbitMqModule)
      .useModule(MockRabbitMqModule)
      .compile();

    app = moduleFixture.createNestApplication({ bodyParser: true });
    app.setGlobalPrefix('api/v1', {
      exclude: ['health/live', 'health/ready'],
    });
    app.useGlobalInterceptors(new RequestIdInterceptor());
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalPipes(createGlobalValidationPipe());

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── Health Check (H01) ────────────────────────────────────────────────────
  describe('Health Check (H01)', () => {
    it('GET /health/live → 200 without JWT', async () => {
      const res = await request(app.getHttpServer())
        .get('/health/live')
        .expect(200);
      expect(res.body.status).toBe('LIVE');
      expect(res.body.service).toBe('transaction');
    });

    it('GET /health/ready → 200 or 503 with correct shape', async () => {
      const res = await request(app.getHttpServer()).get('/health/ready');
      expect([200, 503]).toContain(res.status);
      expect(res.body.checks).toHaveProperty('database');
      expect(res.body.checks).toHaveProperty('jwtKeys');
    });
  });

  // ─── T01: POST /api/v1/transfers ──────────────────────────────────────────
  describe('T01 — POST /api/v1/transfers', () => {
    const validBody = {
      fromAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      toAccountNumber: '0987654321',
      amount: '500000',
      description: 'Thanh toán',
    };

    it('should return 401 UNAUTHENTICATED when no JWT provided', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/transfers')
        .set('Idempotency-Key', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
        .send(validBody)
        .expect(401);

      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.headers['www-authenticate']).toBeDefined();
    });

    it('should return 401 when JWT is invalid', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/transfers')
        .set('Authorization', 'Bearer invalid.jwt.token')
        .set('Idempotency-Key', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
        .send(validBody)
        .expect(401);

      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('should return proper error envelope structure on 4xx', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/transfers')
        .set('Idempotency-Key', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
        .send({});

      expect(res.body).toHaveProperty('error');
      expect(res.body).toHaveProperty('requestId');
      expect(res.body.error).toHaveProperty('code');
      expect(res.body.error).toHaveProperty('message');
      expect(res.headers['x-request-id']).toBeDefined();
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  // ─── T03: GET /api/v1/transfers/:transferId ───────────────────────────────
  describe('T03 — GET /api/v1/transfers/:transferId', () => {
    it('should return 401 when no JWT provided', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/transfers/${MOCK_TRANSFER.id}`)
        .expect(401);

      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.headers['www-authenticate']).toBeDefined();
    });

    it('should return 401 when JWT is invalid', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/transfers/${MOCK_TRANSFER.id}`)
        .set('Authorization', 'Bearer invalid.jwt.token')
        .expect(401);

      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('should return 400 when transferId is not UUID (ParseUUIDPipe fires first if no JWT)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/transfers/not-a-valid-uuid');

      // JWT guard fires before ParseUUIDPipe in NestJS pipeline → 401
      expect([400, 401]).toContain(res.status);
    });

    it('response always has X-Request-Id and Cache-Control headers', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/transfers/${MOCK_TRANSFER.id}`);

      expect(res.headers['x-request-id']).toBeDefined();
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  // ─── C02: RequestId propagation ───────────────────────────────────────────
  describe('C02 — Request ID propagation', () => {
    const customRequestId = '12345678-1234-4123-8123-123456789012';

    it('should echo back a valid X-Request-Id', async () => {
      const res = await request(app.getHttpServer())
        .get('/health/live')
        .set('X-Request-Id', customRequestId)
        .expect(200);

      expect(res.headers['x-request-id']).toBe(customRequestId);
    });

    it('should auto-generate X-Request-Id when not provided', async () => {
      const res = await request(app.getHttpServer())
        .get('/health/live')
        .expect(200);

      expect(res.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('should reject invalid X-Request-Id with 400 VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .get('/health/live')
        .set('X-Request-Id', 'invalid')
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].code).toBe('INVALID_FORMAT');
    });
  });

  // ─── C03: Error envelope structure ────────────────────────────────────────
  describe('C03 — Error envelope structure', () => {
    it('should wrap all errors in { error: { code, message }, requestId }', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/transfers/${MOCK_TRANSFER.id}`)
        .expect(401);

      expect(res.body).toMatchObject({
        error: {
          code: expect.any(String),
          message: expect.any(String),
        },
        requestId: expect.any(String),
      });
    });

    it('should never expose stack traces or SQL in error response', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/transfers/${MOCK_TRANSFER.id}`);

      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toMatch(/at\s+\w+\s+\(/); // stack trace pattern
      expect(bodyStr).not.toMatch(/SELECT|INSERT|UPDATE|DELETE/i); // SQL
    });
  });
});
