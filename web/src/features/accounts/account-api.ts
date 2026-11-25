import { apiRequest } from '../../shared/api/client';
import type { Account } from '../../shared/api/contracts';

export function getMyAccount(accessToken: string) {
  return apiRequest<Account>('GET', '/api/v1/accounts/me', { accessToken });
}

export function openMyAccount(accessToken: string) {
  return apiRequest<Account>('POST', '/api/v1/accounts', { accessToken, body: {} });
}
