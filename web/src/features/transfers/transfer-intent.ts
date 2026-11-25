import type { Account, RecipientLookup, Transfer, TransferInput } from '../../shared/api/contracts';

export interface TransferReview {
  source: Account;
  recipient: RecipientLookup;
  body: Required<TransferInput>;
}

export interface TransferIntent extends TransferReview {
  key: string;
  receivedAt?: number;
  transfer?: Transfer;
}

const activeIntents = new Map<string, TransferIntent>();

export function readTransferIntent(userId: string) {
  return activeIntents.get(userId);
}

export function beginTransferIntent(userId: string, review: TransferReview) {
  const intent = { ...review, key: crypto.randomUUID() };
  activeIntents.set(userId, intent);
  return intent;
}

export function recordTransferResponse(userId: string, key: string, transfer: Transfer) {
  const previous = readTransferIntent(userId);
  if (previous?.key !== key) return undefined;
  if (previous.transfer && previous.transfer.status !== 'PENDING') return previous;

  const intent = { ...previous, transfer, receivedAt: previous.receivedAt ?? Date.now() };
  activeIntents.set(userId, intent);
  return intent;
}

export function clearTransferIntent(userId: string, key: string) {
  if (readTransferIntent(userId)?.key === key) activeIntents.delete(userId);
}
