import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Module } from '@nestjs/common';
import { json, urlencoded } from 'express';
import * as http from 'node:http';
import request from 'supertest';
import { App } from 'supertest/types';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { AppModule } from './../src/app.module';
import { DatabaseModule } from '../src/database/database.module';
import { NotificationsModule } from '../src/notifications/notifications.module';
import { RabbitMqModule } from '../src/rabbitmq/rabbitmq.module';
import { NotificationController } from '../src/notifications/notification.controller';
import { NotificationService } from '../src/notifications/notification.service';
import { RequestIdInterceptor } from '../src/common/interceptors/request-id.interceptor';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe';
import { contentTypeJsonMiddleware } from '../src/common/middleware/content-type.middleware';
import { ResourceNotFoundException } from '../src/common/exceptions/app.exception';

@Module({})
class MockDatabaseModule {}

@Module({})
class MockRabbitMqModule {}

const USER_SUB = '11111111-1111-4111-8111-111111111111';
const NOTIF_ID = '55555555-5555-4555-8555-555555555555';

const MOCK_NOTIFICATION = {
  id: NOTIF_ID,
  transferId: '33333333-3333-4333-8333-333333333333',
  type: 'TRANSFER_SUCCEEDED',
  direction: 'INCOMING' as const,
  amount: '100000',
  currency: 'VND',
  message: 'Bạn đã nhận 100.000 VND từ tài khoản 1000000001',
  createdAt: '2026-11-02T03:00:00.000Z',
  readAt: null,
};

const mockNotificationService = {
  findAll: jest.fn(),
  markAsRead: jest.fn(),
};

@Module({
  controllers: [NotificationController],
  providers: [
    { provide: NotificationService, useValue: mockNotificationService },
  ],
})
class MockNotificationsModule {}

describe('Notification Service Full HTTP Integration Tests (C02–C05, N01–N02)', () => {
  let app: INestApplication<App>;
  let jwksServer: http.Server;
  let accessToken: string;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(publicKey);
    publicJwk.use = 'sig';
    publicJwk.alg = 'RS256';
    publicJwk.kid = 'test-notif-key';

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

    accessToken = await new SignJWT({
      role: 'CUSTOMER',
      name: 'Nguyen Van A',
      jti: '77777777-7777-4777-8777-777777777777',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-notif-key' })
      .setSubject(USER_SUB)
      .setIssuer('mini-bank-user')
      .setAudience('mini-bank-api')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideModule(DatabaseModule)
      .useModule(MockDatabaseModule)
      .overrideModule(NotificationsModule)
      .useModule(MockNotificationsModule)
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

  describe('Health Check (H01)', () => {
    it('GET /health/live → 200 without JWT', async () => {
      const res = await request(app.getHttpServer())
        .get('/health/live')
        .expect(200);
      expect(res.body.status).toBe('LIVE');
      expect(res.body.service).toBe('notification');
    });

    it('GET /health/ready → 200 or 503 with broker check', async () => {
      const res = await request(app.getHttpServer()).get('/health/ready');
      expect([200, 503]).toContain(res.status);
      expect(res.body.checks).toHaveProperty('broker');
    });
  });

  describe('N01 — GET /api/v1/notifications', () => {
    it('401 UNAUTHENTICATED without token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .expect(401);

      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.headers['www-authenticate']).toBe('Bearer');
    });

    it('200 OK with data.items, meta.unreadCount and X-Total-Count header', async () => {
      mockNotificationService.findAll.mockResolvedValue({
        items: [MOCK_NOTIFICATION],
        meta: {
          page: 1,
          pageSize: 20,
          totalItems: 1,
          totalPages: 1,
          unreadCount: 1,
        },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications?page=1&pageSize=20&unreadOnly=true')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.headers['x-total-count']).toBe('1');
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.meta).toEqual({
        page: 1,
        pageSize: 20,
        totalItems: 1,
        totalPages: 1,
        unreadCount: 1,
      });
    });

    it('400 VALIDATION_ERROR when unknown query param or invalid pageSize (>100)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications?pageSize=200&extra=1')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('N02 — PATCH /api/v1/notifications/:notificationId/read', () => {
    it('200 OK with empty JSON body {}', async () => {
      mockNotificationService.markAsRead.mockResolvedValue({
        ...MOCK_NOTIFICATION,
        readAt: '2026-11-02T03:05:00.000Z',
      });

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/notifications/${NOTIF_ID}/read`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(200);

      expect(res.body.data.readAt).toBe('2026-11-02T03:05:00.000Z');
    });

    it('404 RESOURCE_NOT_FOUND when notification missing or belongs to someone else', async () => {
      mockNotificationService.markAsRead.mockRejectedValue(
        new ResourceNotFoundException('Thông báo không tồn tại'),
      );

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/notifications/${NOTIF_ID}/read`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(404);

      expect(res.body.error.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('400 INVALID_FORMAT when notificationId is not UUID', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/notifications/not-a-uuid/read')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].code).toBe('INVALID_FORMAT');
    });
  });
});
