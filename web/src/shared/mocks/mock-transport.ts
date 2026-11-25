import type { ApiErrorDetail, ApiErrorEnvelope, ApiRequest, ApiSuccess } from '../api/contracts';
import {
  normalizeDisplayName,
  normalizeEmail,
  validateUserField,
} from '../api/user-validation';
import type { UserField, UserOperation } from '../api/user-validation';
import {
  getMockSession,
  getMockUser,
  registerMockUser,
  signInMockUser,
  updateMockDisplayName,
} from './mock-user';
import { accountNumberPattern } from '../../features/transfers/transfer-validation';
import { findMockAccountByNumber, getMockAccount, openMockAccount } from './mock-account';
import { createMockTransfer, getMockTransfer, mockTransferIdPattern } from './mock-transfer';

const rateWindows = new Map<string, number[]>();
const windowLength = 60_000;
const loginFields = ['email', 'password'] as const;
const registerFields = ['displayName', ...loginFields] as const;
const profileFields = ['displayName'] as const;

function rateDelay(key: string, limit: number, count = true) {
  const now = Date.now();
  const times = (rateWindows.get(key) ?? []).filter((time) => time > now - windowLength);
  if (times.length >= limit) {
    return Math.max(1, Math.ceil((times[0] + windowLength - now) / 1_000));
  }
  if (count) times.push(now);
  rateWindows.set(key, times);
  return undefined;
}

function validBody<T extends UserField>(
  body: unknown,
  fields: readonly T[],
  operation: UserOperation,
): { values: Record<T, string> } | { details: ApiErrorDetail[] } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { details: [{ field: 'body', code: 'INVALID_FORMAT', message: 'Nội dung phải là một đối tượng JSON.' }] };
  }

  const input = body as Record<string, unknown>;
  const details: ApiErrorDetail[] = Object.keys(input)
    .filter((key) => !(fields as readonly string[]).includes(key))
    .map((key) => ({ field: key, code: 'UNKNOWN_FIELD', message: 'Trường này không được hỗ trợ.' }));

  const values = {} as Record<T, string>;
  for (const field of fields) {
    const value = input[field];
    const message = typeof value === 'string'
      ? validateUserField(field, value, operation)
      : 'Vui lòng nhập giá trị hợp lệ.';
    if (message) details.push({ field, code: 'INVALID_FORMAT', message });
    else if (typeof value === 'string') values[field] = value;
  }
  return details.length ? { details } : { values };
}

export async function mockTransport(request: ApiRequest): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 180));

  const requestId = crypto.randomUUID();
  const responseHeaders = new Headers({ 'Cache-Control': 'no-store', 'X-Request-Id': requestId });

  function success<T>(data: T, status = 200) {
    const payload: ApiSuccess<T> = { data, requestId };
    return Response.json(payload, { status, headers: responseHeaders });
  }

  function error(status: number, code: string, message: string, details: ApiErrorDetail[] = []) {
    const payload: ApiErrorEnvelope = { error: { code, message, details }, requestId };
    return Response.json(payload, { status, headers: responseHeaders });
  }

  function limited(seconds: number) {
    responseHeaders.set('Retry-After', String(seconds));
    return error(429, 'RATE_LIMITED', 'Có quá nhiều yêu cầu. Vui lòng chờ rồi thử lại.');
  }

  function unauthenticated() {
    responseHeaders.set('WWW-Authenticate', 'Bearer');
    return error(401, 'UNAUTHENTICATED', 'Phiên đăng nhập đã hết hạn.');
  }

  const url = new URL(request.path, 'https://minibank.mock');

  if (request.method === 'POST' && request.path === '/api/v1/auth/register') {
    const delay = rateDelay('register', 10);
    if (delay) return limited(delay);

    const body = validBody(request.body, registerFields, 'register');
    if ('details' in body) return error(400, 'VALIDATION_ERROR', 'Dữ liệu yêu cầu không hợp lệ.', body.details);

    const { email, password, displayName } = body.values;
    const user = registerMockUser(normalizeEmail(email), password, normalizeDisplayName(displayName));
    return user
      ? success(user, 201)
      : error(409, 'EMAIL_ALREADY_EXISTS', 'Email này đã được đăng ký.');
  }

  if (request.method === 'POST' && request.path === '/api/v1/auth/login') {
    const requestDelay = rateDelay('login', 30);
    if (requestDelay) return limited(requestDelay);

    const body = validBody(request.body, loginFields, 'login');
    if ('details' in body) return error(400, 'VALIDATION_ERROR', 'Dữ liệu yêu cầu không hợp lệ.', body.details);

    const email = normalizeEmail(body.values.email);
    const failureKey = 'login:' + email;
    const failedDelay = rateDelay(failureKey, 5, false);
    if (failedDelay) return limited(failedDelay);

    const session = signInMockUser(email, body.values.password);
    if (session) return success(session);

    rateDelay(failureKey, 5);
    return error(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.');
  }

  if (request.path === '/api/v1/users/me') {
    const session = getMockSession(request.headers.get('Authorization'));
    if (!session) return unauthenticated();
    const user = getMockUser(session.userId);
    if (!user) return error(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy hồ sơ.');

    if (request.method === 'GET') return success(user);

    if (request.method === 'PATCH') {
      const body = validBody(request.body, profileFields, 'profile');
      if ('details' in body) return error(400, 'VALIDATION_ERROR', 'Dữ liệu yêu cầu không hợp lệ.', body.details);

      return success(updateMockDisplayName(user.id, normalizeDisplayName(body.values.displayName)));
    }

    responseHeaders.set('Allow', 'GET, PATCH');
    return error(405, 'METHOD_NOT_ALLOWED', 'Thao tác này không được hỗ trợ.');
  }

  if (url.pathname === '/api/v1/accounts/lookup' && request.method === 'GET') {
    const session = getMockSession(request.headers.get('Authorization'));
    if (!session) return unauthenticated();
    if (session.role !== 'CUSTOMER') return error(403, 'FORBIDDEN', 'Chức năng này dành cho khách hàng.');

    const delay = rateDelay('recipient:' + session.userId, 30);
    if (delay) return limited(delay);

    const number = url.searchParams.get('number');
    if (!number || !accountNumberPattern.test(number) || url.searchParams.size !== 1) {
      return error(400, 'VALIDATION_ERROR', 'Số tài khoản phải gồm đúng 10 chữ số.', [
        { field: 'number', code: 'INVALID_FORMAT', message: 'Nhập đúng 10 chữ số của tài khoản nhận.' },
      ]);
    }
    const recipient = findMockAccountByNumber(number);
    if (!recipient) return error(404, 'RECIPIENT_NOT_FOUND', 'Không tìm thấy số tài khoản này.');

    const { accountNumber, accountName, currency } = recipient;
    return success({ accountNumber, accountName, currency });
  }

  if (request.path === '/api/v1/transfers' && request.method === 'POST') {
    const session = getMockSession(request.headers.get('Authorization'));
    if (!session) return unauthenticated();
    if (session.role !== 'CUSTOMER') return error(403, 'FORBIDDEN', 'Chức năng này dành cho khách hàng.');

    const delay = rateDelay('transfer:' + session.userId, 30);
    if (delay) return limited(delay);

    const result = createMockTransfer(session.userId, request.headers.get('Idempotency-Key'), request.body);
    if ('code' in result) {
      if (result.status === 503) responseHeaders.set('Retry-After', '5');
      return error(result.status, result.code, result.message, result.details);
    }

    responseHeaders.set('Location', '/api/v1/transfers/' + result.transfer.id);
    responseHeaders.set('Idempotency-Replayed', String(result.replayed));
    if (result.transfer.status === 'PENDING') {
      responseHeaders.set('Retry-After', '2');
      return success(result.transfer, 202);
    }
    return success(result.transfer, result.replayed ? 200 : 201);
  }

  const transferDetail = /^\/api\/v1\/transfers\/([^/]+)$/.exec(url.pathname);
  if (transferDetail && request.method === 'GET') {
    const session = getMockSession(request.headers.get('Authorization'));
    if (!session) return unauthenticated();

    const [, transferId] = transferDetail;
    if (url.search || !mockTransferIdPattern.test(transferId)) {
      return error(400, 'VALIDATION_ERROR', 'Mã giao dịch không hợp lệ.');
    }
    const transfer = getMockTransfer(transferId, session.userId, session.role === 'ADMIN');
    if (!transfer) return error(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy giao dịch.');
    if (transfer.status === 'PENDING') responseHeaders.set('Retry-After', '2');
    return success(transfer);
  }

  if (request.path === '/api/v1/accounts' || request.path === '/api/v1/accounts/me') {
    const session = getMockSession(request.headers.get('Authorization'));
    if (!session) return unauthenticated();
    if (session.role !== 'CUSTOMER') {
      return error(403, 'FORBIDDEN', 'Chức năng này dành cho khách hàng.');
    }

    if (request.path === '/api/v1/accounts/me' && request.method === 'GET') {
      const account = getMockAccount(session.userId);
      return account
        ? success(account)
        : error(404, 'ACCOUNT_NOT_FOUND', 'Bạn chưa mở tài khoản VND.');
    }

    if (request.path === '/api/v1/accounts' && request.method === 'POST') {
      const body = request.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
        return error(400, 'VALIDATION_ERROR', 'Nội dung mở tài khoản phải là đối tượng rỗng.', [
          { field: 'body', code: 'INVALID_FORMAT', message: 'Gửi một đối tượng JSON rỗng.' },
        ]);
      }

      const { account, created } = openMockAccount(session.userId, session.nameAtSignIn);
      if (created) responseHeaders.set('Location', '/api/v1/accounts/me');
      return success(account, created ? 201 : 200);
    }

    responseHeaders.set('Allow', request.path === '/api/v1/accounts/me' ? 'GET' : 'POST');
    return error(405, 'METHOD_NOT_ALLOWED', 'Thao tác này không được hỗ trợ.');
  }

  return error(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy tài nguyên.');
}
