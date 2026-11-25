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

  // 1. Giới hạn body 16 KiB
  app.use(json({ limit: '16kb' }));
  app.use(urlencoded({ extended: true, limit: '16kb' }));

  // 2. Global prefix /api/v1
  app.setGlobalPrefix('api/v1', {
    exclude: ['health/live', 'health/ready'],
  });

  // 3. RequestIdInterceptor & GlobalExceptionFilter
  app.useGlobalInterceptors(new RequestIdInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());

  // 4. Global ValidationPipe
  app.useGlobalPipes(createGlobalValidationPipe());

  // 5. CORS
  const publicOrigin = process.env.PUBLIC_ORIGIN || 'http://localhost:8080';
  app.enableCors({
    origin: publicOrigin,
    credentials: true,
    exposedHeaders: ['X-Request-Id', 'X-Total-Count'],
  });

  // 6. Swagger / OpenAPI (tắt trong production)
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Notification Service API')
      .setDescription(
        'Mini-Bank Notification Service — quản lý thông báo giao dịch\n\n' +
          '**Hợp đồng chính:** N01 (GET /notifications), N02 (PATCH /notifications/:id/read)\n\n' +
          '**Xác thực:** Bearer JWT RS256 (JWKS tại /api/v1/auth/jwks của User Service)',
      )
      .setVersion(process.env.APP_VERSION || '1.0.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'JWT',
      )
      .addServer(`http://localhost:${process.env.PORT ?? 3004}`)
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  app.enableShutdownHooks();
  const port = process.env.PORT ?? 3004;
  await app.listen(port);
}
void bootstrap();
