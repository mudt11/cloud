import { apiRequest } from '../../shared/api/client';
import type { RecipientLookup, Transfer, TransferInput } from '../../shared/api/contracts';

export function lookUpRecipient(accessToken: string, number: string) {
  const query = new URLSearchParams({ number });
  return apiRequest<RecipientLookup>('GET', `/api/v1/accounts/lookup?${query}`, { accessToken });
}

export function submitTransfer(accessToken: string, body: TransferInput, idempotencyKey: string) {
  return apiRequest<Transfer>('POST', '/api/v1/transfers', { accessToken, body, idempotencyKey });
}

export function getTransfer(accessToken: string, transferId: string) {
  return apiRequest<Transfer>('GET', `/api/v1/transfers/${encodeURIComponent(transferId)}`, { accessToken });
}
