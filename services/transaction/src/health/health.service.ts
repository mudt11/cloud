import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';

export interface ReadyCheckResult {
  service: string;
  status: 'READY' | 'NOT_READY';
  version: string;
  checkedAt: string;
  checks: {
    database: 'UP' | 'DOWN';
    jwtKeys: 'UP' | 'DOWN';
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly configService: ConfigService) {}

  getServiceName(): string {
    return this.configService.get<string>('SERVICE_NAME') || 'transaction';
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

  async checkReady(): Promise<ReadyCheckResult> {
    const [dbStatus, jwtStatus] = await Promise.all([
      this.checkDatabase(),
      this.checkJwtKeys(),
    ]);

    const isReady = dbStatus === 'UP' && jwtStatus === 'UP';

    return {
      service: this.getServiceName(),
      status: isReady ? 'READY' : 'NOT_READY',
      version: this.getAppVersion(),
      checkedAt: new Date().toISOString(),
      checks: {
        database: dbStatus,
        jwtKeys: jwtStatus,
      },
    };
  }
}
