import { mockTransport } from '../mocks/mock-transport';
import type { ApiErrorDetail, ApiErrorEnvelope, ApiRequest, ApiSuccess } from './contracts';

export const sessionEvents = new EventTarget();

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ApiErrorDetail[] = [],
    readonly retryAfterSeconds?: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  body?: unknown;
  accessToken?: string;
  idempotencyKey?: string;
}

export async function apiRequest<T>(
  method: ApiRequest['method'],
  path: ApiRequest['path'],
  { body, accessToken, idempotencyKey }: RequestOptions = {},
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', 'Bearer ' + accessToken);
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);

  const response = await mockTransport({ method, path, headers, body });
  const payload: ApiSuccess<T> | ApiErrorEnvelope = await response.json();

  if (response.ok && 'data' in payload) return payload.data;

  const retryAfterValue = response.headers.get('Retry-After');
  const retryAfterSeconds = retryAfterValue && /^[1-9][0-9]*$/.test(retryAfterValue)
    ? Number(retryAfterValue)
    : undefined;
  const apiError = 'error' in payload
    ? new ApiError(
        response.status,
        payload.error.code,
        payload.error.message,
        payload.error.details,
        retryAfterSeconds,
        payload.requestId,
      )
    : new ApiError(response.status, 'INVALID_RESPONSE', 'MiniBank nhận được phản hồi không hợp lệ.');

  if (accessToken && apiError.status === 401 && apiError.code === 'UNAUTHENTICATED') {
    sessionEvents.dispatchEvent(new CustomEvent('expired', { detail: accessToken }));
  }

  throw apiError;
}
