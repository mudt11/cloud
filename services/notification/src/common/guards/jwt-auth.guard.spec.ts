import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  ServiceUnavailableException,
  UnauthenticatedException,
} from '../exceptions/app.exception';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;
  let configService: ConfigService;

  beforeEach(() => {
    reflector = new Reflector();
    configService = new ConfigService({
      JWT_JWKS_URL: 'http://localhost:3001/api/v1/auth/jwks',
      JWT_ISSUER: 'mini-bank-user',
      JWT_AUDIENCE: 'mini-bank-api',
    });
    guard = new JwtAuthGuard(reflector, configService);
  });

  function createMockContext(
    authHeader?: string,
    isPublic = false,
  ): ExecutionContext {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic);

    const req: any = {
      headers: authHeader ? { authorization: authHeader } : {},
    };

    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext;
  }

  it('should allow access to public routes without token', async () => {
    const ctx = createMockContext(undefined, true);
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('should throw UnauthenticatedException when authorization header is missing', async () => {
    const ctx = createMockContext(undefined, false);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      UnauthenticatedException,
    );
  });

  it('should throw UnauthenticatedException when header format is not Bearer', async () => {
    const ctx = createMockContext('Basic dXNlcjpwYXNz', false);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      UnauthenticatedException,
    );
  });

  it('should throw ServiceUnavailableException when JWKS endpoint cannot be reached', async () => {
    const fakeToken =
      'eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3QifQ.eyJzdWIiOiIxMTExMTExMS0xMTExLTQxMTEtODExMS0xMTExMTExMTExMTEiLCJyb2xlIjoiQ1VTVE9NRVIifQ.signature';
    const ctx = createMockContext(`Bearer ${fakeToken}`, false);

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
