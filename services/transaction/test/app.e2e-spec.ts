import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Module } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { DatabaseModule } from '../src/database/database.module';
import { TransfersModule } from '../src/transfers/transfers.module';
import { RabbitMqModule } from '../src/rabbitmq/rabbitmq.module';
import { RequestIdInterceptor } from '../src/common/interceptors/request-id.interceptor';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe';

@Module({})
class MockDatabaseModule {}

@Module({})
class MockTransfersModule {}

@Module({})
class MockRabbitMqModule {}

describe('Transaction Service E2E', () => {
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

  describe('Health Check (H01)', () => {
    it('GET /health/live should return HTTP 200 without api/v1 prefix, unnested', async () => {
      const res = await request(app.getHttpServer())
        .get('/health/live')
        .expect(200);

      expect(res.body).toEqual({
        service: 'transaction',
        status: 'LIVE',
        version: 'dev',
        checkedAt: expect.any(String),
      });
      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('GET /health/ready should return HTTP 200 or 503 according to checks', async () => {
      const res = await request(app.getHttpServer()).get('/health/ready');

      expect([200, 503]).toContain(res.status);
      expect(res.body.service).toBe('transaction');
      expect(['READY', 'NOT_READY']).toContain(res.body.status);
      expect(res.body.checks).toHaveProperty('database');
      expect(res.body.checks).toHaveProperty('jwtKeys');
    });
  });

  describe('Prefix & Request ID & Headers (C02, C03)', () => {
    it('GET /api/v1 should return 200 with X-Request-Id and Cache-Control: no-store', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1').expect(200);

      expect(res.text).toBe('Hello World!');
      expect(res.headers['x-request-id']).toBeDefined();
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('should propagate a valid incoming X-Request-Id', async () => {
      const customId = '99999999-9999-4999-8999-999999999999';
      const res = await request(app.getHttpServer())
        .get('/api/v1')
        .set('X-Request-Id', customId)
        .expect(200);

      expect(res.headers['x-request-id']).toBe(customId);
    });

    it('should reject invalid X-Request-Id with 400 VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1')
        .set('X-Request-Id', 'not-valid-uuid')
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].field).toBe('x-request-id');
      expect(res.body.error.details[0].code).toBe('INVALID_FORMAT');
      expect(res.headers['x-request-id']).toBe(res.body.requestId);
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });
});
