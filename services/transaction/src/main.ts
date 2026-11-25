import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { createGlobalValidationPipe } from './common/pipes/validation.pipe';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { contentTypeJsonMiddleware } from './common/middleware/content-type.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // 0. Kiểm tra Content-Type cho request có body (C02, 415 UNSUPPORTED_MEDIA_TYPE)
  app.use(contentTypeJsonMiddleware);

  // 1. Giới hạn body 16 KiB (413 PAYLOAD_TOO_LARGE khi vượt quá)
  app.use(json({ limit: '16kb' }));
  app.use(urlencoded({ extended: true, limit: '16kb' }));

  // 2. Global prefix /api/v1 (loại trừ health/live, health/ready ở gốc service)
  app.setGlobalPrefix('api/v1', {
    exclude: ['health/live', 'health/ready'],
  });

  // 3. RequestIdInterceptor & GlobalExceptionFilter (C02, C03)
  app.useGlobalInterceptors(new RequestIdInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());

  // 4. Global ValidationPipe (C03)
  app.useGlobalPipes(createGlobalValidationPipe());

  // 5. CORS
  const publicOrigin = process.env.PUBLIC_ORIGIN || 'http://localhost:8080';
  app.enableCors({
    origin: publicOrigin,
    credentials: true,
    exposedHeaders: [
      'X-Request-Id',
      'Idempotency-Replayed',
      'Location',
      'Retry-After',
      'X-Total-Count',
    ],
  });

  // 6. Swagger / OpenAPI (tắt trong production)
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Transaction Service API')
      .setDescription(
        'Mini-Bank Transaction Service — chuyển tiền nội địa (VND), lịch sử & báo cáo\n\n' +
          '**Hợp đồng chính:** T01 (POST /transfers), T02 (GET /transfers), T03 (GET /transfers/:id), T04 (GET /reports/summary), T05 (GET /reports/export)\n\n' +
          '**Xác thực:** Bearer JWT RS256 (JWKS tại /api/v1/auth/jwks của User Service)\n\n' +
          '**Idempotency:** Mọi POST /transfers yêu cầu header `Idempotency-Key` (UUID v4)',
      )
      .setVersion(process.env.APP_VERSION || '1.0.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'JWT',
      )
      .addServer(`http://localhost:${process.env.PORT ?? 3003}`)
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  app.enableShutdownHooks();
  const port = process.env.PORT ?? 3003;
  await app.listen(port);
}
void bootstrap();
