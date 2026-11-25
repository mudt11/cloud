import { apiRequest } from '../../shared/api/client';
import type { LoginData, LoginInput, RegisterInput, User } from '../../shared/api/contracts';
import { normalizeDisplayName } from '../../shared/api/user-validation';
import { normalizeLogin, normalizeRegistration } from './auth-validation';

export function registerUser(input: RegisterInput) {
  return apiRequest<User>('POST', '/api/v1/auth/register', { body: normalizeRegistration(input) });
}

export function loginUser(input: LoginInput) {
  return apiRequest<LoginData>('POST', '/api/v1/auth/login', { body: normalizeLogin(input) });
}

export function getProfile(accessToken: string) {
  return apiRequest<User>('GET', '/api/v1/users/me', { accessToken });
}

export function saveDisplayName(accessToken: string, displayName: string) {
  return apiRequest<User>('PATCH', '/api/v1/users/me', {
    body: { displayName: normalizeDisplayName(displayName) },
    accessToken,
  });
}
