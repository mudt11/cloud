import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from 'jose';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  ServiceUnavailableException,
  UnauthenticatedException,
} from '../exceptions/app.exception';

export interface AuthenticatedUser {
  sub: string;
  role: 'CUSTOMER' | 'ADMIN';
  name?: string;
  [key: string]: any;
}

declare module 'express' {
  interface Request {
    user?: AuthenticatedUser;
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  private jwksUrl: string;
  private issuer: string;
  private audience: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {
    this.jwksUrl =
      this.configService.get<string>('JWT_JWKS_URL') ||
      'http://localhost:3001/api/v1/auth/jwks';
    this.issuer =
      this.configService.get<string>('JWT_ISSUER') || 'mini-bank-user';
    this.audience =
      this.configService.get<string>('JWT_AUDIENCE') || 'mini-bank-api';

    this.initJWKS();
  }

  private initJWKS() {
    try {
      this.jwks = createRemoteJWKSet(new URL(this.jwksUrl), {
        cacheMaxAge: 300_000, // 300 seconds cache
        cooldownDuration: 30_000, // cooldown before retrying unfulfilled kid
      });
    } catch (err: any) {
      this.logger.error(
        `Failed to initialize JWKS client for ${this.jwksUrl}: ${err.message}`,
      );
      this.jwks = null;
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthenticatedException('Thiếu header Authorization');
    }

    const parts = authHeader.trim().split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
      throw new UnauthenticatedException(
        'Header Authorization phải có định dạng Bearer <token>',
      );
    }

    const token = parts[1];

    if (!this.jwks) {
      this.initJWKS();
      if (!this.jwks) {
        throw new ServiceUnavailableException(
          'Không thể kết nối đến máy chủ xác thực để lấy JWKS',
        );
      }
    }

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['RS256'],
        clockTolerance: 30, // 30 seconds clock skew tolerance
      });

      if (!payload.sub || typeof payload.sub !== 'string') {
        throw new UnauthenticatedException('Token thiếu trường sub (userId)');
      }

      const role = payload['role'];
      if (role !== 'CUSTOMER' && role !== 'ADMIN') {
        throw new UnauthenticatedException(
          'Role trong token không hợp lệ (phải là CUSTOMER hoặc ADMIN)',
        );
      }

      request.user = {
        sub: payload.sub,
        role: role as 'CUSTOMER' | 'ADMIN',
        name: typeof payload['name'] === 'string' ? payload['name'] : undefined,
        ...payload,
      };

      return true;
    } catch (err: any) {
      if (
        err instanceof UnauthenticatedException ||
        err instanceof ServiceUnavailableException
      ) {
        throw err;
      }

      // Detect JWKS unreachable / network errors
      if (
        err instanceof joseErrors.JWKSTimeout ||
        err instanceof joseErrors.JWKSInvalid ||
        err?.code === 'ERR_JWKS_UNAVAILABLE' ||
        err?.name === 'FetchError' ||
        err?.cause?.code === 'ECONNREFUSED' ||
        err?.code === 'ECONNREFUSED' ||
        err?.message?.includes('fetch failed')
      ) {
        this.logger.warn(
          `JWKS fetch failed from ${this.jwksUrl}: ${err.message}`,
        );
        throw new ServiceUnavailableException(
          'Không thể nạp khóa xác thực từ JWKS',
        );
      }

      // Any token signature, format, or expiration error
      throw new UnauthenticatedException(
        'Access token không hợp lệ hoặc đã hết hạn',
      );
    }
  }
}
