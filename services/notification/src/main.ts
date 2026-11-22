import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { createGlobalValidationPipe } from './common/pipes/validation.pipe';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

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

  // CORS
  const publicOrigin = process.env.PUBLIC_ORIGIN || 'http://localhost:8080';
  app.enableCors({
    origin: publicOrigin,
    credentials: true,
  });

  const port = process.env.PORT ?? 3004;
  await app.listen(port);
}
void bootstrap();
