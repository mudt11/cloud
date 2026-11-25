import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Module } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { DatabaseModule } from '../src/database/database.module';
import { NotificationsModule } from '../src/notifications/notifications.module';
import { RabbitMqModule } from '../src/rabbitmq/rabbitmq.module';
import { NotificationController } from '../src/notifications/notification.controller';
import { NotificationService } from '../src/notifications/notification.service';
import { RequestIdInterceptor } from '../src/common/interceptors/request-id.interceptor';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe';

@Module({})
class MockDatabaseModule {}

@Module({})
class MockRabbitMqModule {}

const NOTIF_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const mockNotificationService = {
  findAll: jest.fn(),
  markAsRead: jest.fn(),
};

/**
 * MockNotificationsModule giữ lại NotificationController nhưng mock NotificationService
 */
@Module({
  controllers: [NotificationController],
  providers: [{ provide: NotificationService, useValue: mockNotificationService }],
})
class MockNotificationsModule {}

describe('Notification Service Integration Tests', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
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
      expect(res.body.service).toBe('notification');
    });

    it('GET /health/ready → 200 or 503 with broker check', async () => {
      const res = await request(app.getHttpServer()).get('/health/ready');
      expect([200, 503]).toContain(res.status);
      expect(res.body.checks).toHaveProperty('broker');
    });
  });

  // ─── N01: GET /api/v1/notifications ──────────────────────────────────────
  describe('N01 — GET /api/v1/notifications', () => {
    it('should return 401 UNAUTHENTICATED when no JWT provided', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .expect(401);

      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.headers['www-authenticate']).toBeDefined();
    });

    it('should return 401 when JWT is invalid', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('Authorization', 'Bearer invalid.jwt.token')
        .expect(401);

      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('response always has X-Request-Id and Cache-Control headers', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications');

      expect(res.headers['x-request-id']).toBeDefined();
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('error response should never expose stack traces', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications');
      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toMatch(/at\s+\w+\s+\(/);
      expect(bodyStr).not.toMatch(/SELECT|INSERT|UPDATE|DELETE/i);
    });
  });

  // ─── N02: PATCH /api/v1/notifications/:id/read ───────────────────────────
  describe('N02 — PATCH /api/v1/notifications/:id/read', () => {
    it('should return 401 when no JWT provided', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/notifications/${NOTIF_ID}/read`)
        .expect(401);

      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('should return 401 when JWT is invalid', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/notifications/${NOTIF_ID}/read`)
        .set('Authorization', 'Bearer bad.token')
        .expect(401);

      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('response always has X-Request-Id and Cache-Control headers', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/notifications/${NOTIF_ID}/read`);

      expect(res.headers['x-request-id']).toBeDefined();
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  // ─── C02 / C03 ────────────────────────────────────────────────────────────
  describe('C02/C03 — Request ID and Error envelope', () => {
    it('should echo back a valid X-Request-Id', async () => {
      const customId = '12345678-1234-4123-8123-123456789012';
      const res = await request(app.getHttpServer())
        .get('/health/live')
        .set('X-Request-Id', customId)
        .expect(200);
      expect(res.headers['x-request-id']).toBe(customId);
    });

    it('should reject invalid X-Request-Id with 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/health/live')
        .set('X-Request-Id', 'bad-id')
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('error responses should never expose stack traces', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/notifications/${NOTIF_ID}/read`);
      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toMatch(/at\s+\w+\s+\(/);
      expect(bodyStr).not.toMatch(/SELECT|INSERT|UPDATE|DELETE/i);
    });
  });
});
