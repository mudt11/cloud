import type { ApiErrorDetail, Transfer, TransferInput } from '../api/contracts';
import {
  accountNumberPattern,
  normalizeTransferAmount,
  normalizeTransferDescription,
} from '../../features/transfers/transfer-validation';
import { applyMockTransfer, findMockAccountByNumber, getMockAccount } from './mock-account';

export const mockTransferIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

const idempotencyKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const supportedFields = ['fromAccountId', 'toAccountNumber', 'amount', 'description'];

interface StoredIntent {
  bodyFingerprint: string;
  transferId: string;
}

type TransferMockResult =
  | { transfer: Transfer; replayed: boolean }
  | { status: number; code: string; message: string; details?: ApiErrorDetail[] };

const transfersById = new Map<string, Transfer>();
const intentsByKey = new Map<string, StoredIntent>();

function validatedBody(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;

  const fields = input as Record<string, unknown>;
  const { fromAccountId, toAccountNumber, amount, description = '' } = fields;
  if (
    Object.keys(fields).some((field) => !supportedFields.includes(field))
    || typeof fromAccountId !== 'string' || !mockTransferIdPattern.test(fromAccountId)
    || typeof toAccountNumber !== 'string' || !accountNumberPattern.test(toAccountNumber)
    || typeof amount !== 'string' || amount !== normalizeTransferAmount(amount)
    || typeof description !== 'string'
  ) return undefined;

  const normalizedDescription = normalizeTransferDescription(description);
  if (Array.from(normalizedDescription).length > 140) return undefined;

  return { fromAccountId, toAccountNumber, amount, description: normalizedDescription } satisfies Required<TransferInput>;
}

export function getMockTransfer(transferId: string, userId: string, allowAdmin: boolean) {
  const transfer = transfersById.get(transferId);
  if (!transfer) return undefined;
  if (allowAdmin || transfer.requesterUserId === userId) return transfer;
  if (transfer.status === 'SUCCEEDED' && getMockAccount(userId)?.id === transfer.toAccountId) return transfer;
  return undefined;
}

export function createMockTransfer(userId: string, rawKey: string | null, input: unknown): TransferMockResult {
  if (!rawKey || !idempotencyKeyPattern.test(rawKey)) {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Khóa giao dịch không hợp lệ.',
      details: [{ field: 'Idempotency-Key', code: 'INVALID_FORMAT', message: 'Dùng UUID v4 chữ thường.' }],
    };
  }

  const body = validatedBody(input);
  if (!body) return { status: 400, code: 'VALIDATION_ERROR', message: 'Thông tin chuyển tiền không hợp lệ.' };

  const scopedKey = userId + ':' + rawKey;
  const bodyFingerprint = JSON.stringify(body);
  const existing = intentsByKey.get(scopedKey);
  if (existing) {
    if (existing.bodyFingerprint !== bodyFingerprint) {
      return { status: 409, code: 'IDEMPOTENCY_CONFLICT', message: 'Mã yêu cầu đã gắn với nội dung giao dịch khác.' };
    }
    const transfer = transfersById.get(existing.transferId);
    if (transfer) return { transfer, replayed: true };
    return { status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Chưa truy xuất được giao dịch.' };
  }

  const source = getMockAccount(userId);
  if (!source || source.id !== body.fromAccountId) {
    return { status: 404, code: 'ACCOUNT_NOT_FOUND', message: 'Không tìm thấy tài khoản nguồn.' };
  }

  const recipient = findMockAccountByNumber(body.toAccountNumber);
  if (!recipient) return { status: 404, code: 'RECIPIENT_NOT_FOUND', message: 'Không tìm thấy người nhận.' };
  if (source.id === recipient.id) {
    return { status: 400, code: 'SAME_ACCOUNT', message: 'Số tài khoản nhận phải khác tài khoản nguồn.' };
  }

  const recipientUserId = recipient.userId;
  const createdAt = new Date().toISOString();
  const transfer: Transfer = {
    id: crypto.randomUUID(),
    requesterUserId: userId,
    fromAccountId: source.id,
    toAccountId: recipient.id,
    fromAccountNumber: source.accountNumber,
    toAccountNumber: recipient.accountNumber,
    amount: body.amount,
    currency: 'VND',
    description: body.description,
    status: 'PENDING',
    reasonCode: null,
    createdAt,
    updatedAt: createdAt,
    committedAt: null,
  };
  transfersById.set(transfer.id, transfer);
  intentsByKey.set(scopedKey, { bodyFingerprint, transferId: transfer.id });

  function settle() {
    if (transfersById.get(transfer.id)?.status !== 'PENDING') return;

    const completion = new Date().toISOString();
    const reasonCode = applyMockTransfer(userId, recipientUserId, transfer.amount, completion);
    transfersById.set(transfer.id, {
      ...transfer,
      status: reasonCode ? 'REJECTED' : 'SUCCEEDED',
      reasonCode,
      updatedAt: completion,
      committedAt: reasonCode ? null : completion,
    });
  }

  if (source.status !== 'ACTIVE' || recipient.status !== 'ACTIVE' || BigInt(source.balance) < BigInt(body.amount)) {
    settle();
    return { transfer: transfersById.get(transfer.id) ?? transfer, replayed: false };
  }

  setTimeout(settle, 1_100);
  return { transfer, replayed: false };
}
