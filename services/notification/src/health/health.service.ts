import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import * as amqp from 'amqplib';
import { RabbitMqService } from '../rabbitmq/rabbitmq.service';

export interface NotificationReadyCheckResult {
  service: string;
  status: 'READY' | 'NOT_READY';
  version: string;
  checkedAt: string;
  checks: {
    database: 'UP' | 'DOWN';
    broker: 'UP' | 'DOWN';
    jwtKeys: 'UP' | 'DOWN';
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly rabbitMqService?: RabbitMqService,
  ) {}

  getServiceName(): string {
    return this.configService.get<string>('SERVICE_NAME') || 'notification';
  }

  getAppVersion(): string {
    return this.configService.get<string>('APP_VERSION') || 'dev';
  }

  async checkDatabase(): Promise<'UP' | 'DOWN'> {
    const connectionString = this.configService.get<string>('DATABASE_URL');
    if (!connectionString) return 'DOWN';

    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 2000,
    });

    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return 'UP';
    } catch (err: any) {
      this.logger.warn(`Database readiness check failed: ${err.message}`);
      try {
        await client.end();
      } catch {}
      return 'DOWN';
    }
  }

  async checkBroker(): Promise<'UP' | 'DOWN'> {
    // Ưu tiên kiểm tra kết nối đang sống của consumer trong tiến trình (H01)
    if (this.rabbitMqService?.isConnected()) {
      return 'UP';
    }

    const amqpUrl =
      this.configService.get<string>('AMQP_URL') ||
      'amqp://guest:guest@localhost:5672';

    try {
      const conn = await Promise.race([
        amqp.connect(amqpUrl),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Broker connection timeout')),
            2000,
          ),
        ),
      ]);
      await conn.close();
      return 'UP';
    } catch (err: any) {
      this.logger.warn(
        `Broker readiness check failed (${amqpUrl}): ${err.message}`,
      );
      return 'DOWN';
    }
  }

  async checkJwtKeys(): Promise<'UP' | 'DOWN'> {
    const jwksUrl =
      this.configService.get<string>('JWT_JWKS_URL') ||
      'http://localhost:3001/api/v1/auth/jwks';

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const res = await fetch(jwksUrl, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = (await res.json()) as any;
        if (data && Array.isArray(data.keys)) {
          return 'UP';
        }
      }
      return 'DOWN';
    } catch (err: any) {
      this.logger.warn(
        `JWKS readiness check failed (${jwksUrl}): ${err.message}`,
      );
      return 'DOWN';
    }
  }

  async checkReady(): Promise<NotificationReadyCheckResult> {
    const [dbStatus, brokerStatus, jwtStatus] = await Promise.all([
      this.checkDatabase(),
      this.checkBroker(),
      this.checkJwtKeys(),
    ]);

    const isReady =
      dbStatus === 'UP' && brokerStatus === 'UP' && jwtStatus === 'UP';

    return {
      service: this.getServiceName(),
      status: isReady ? 'READY' : 'NOT_READY',
      version: this.getAppVersion(),
      checkedAt: new Date().toISOString(),
      checks: {
        database: dbStatus,
        broker: brokerStatus,
        jwtKeys: jwtStatus,
      },
    };
  }
}
