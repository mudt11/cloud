import type { Account } from '../api/contracts';
import { transferDemoUsers } from './mock-user';

const accountsByUser = new Map<string, Account>();
let nextAccountNumber = 1_000_000_003;

transferDemoUsers.forEach((user, index) => {
  accountsByUser.set(user.id, {
    id: crypto.randomUUID(),
    userId: user.id,
    accountNumber: String(1_000_000_001 + index),
    accountName: user.displayName,
    currency: 'VND',
    balance: index === 0 ? '1000000' : '200000',
    status: 'ACTIVE',
    createdAt: user.createdAt,
    updatedAt: user.createdAt,
  });
});

export function getMockAccount(userId: string) {
  return accountsByUser.get(userId);
}

export function findMockAccountByNumber(accountNumber: string) {
  return Array.from(accountsByUser.values()).find((account) => account.accountNumber === accountNumber);
}

export function applyMockTransfer(fromUserId: string, toUserId: string, amount: string, committedAt: string) {
  const source = getMockAccount(fromUserId);
  const destination = getMockAccount(toUserId);
  if (!source || !destination) return 'ACCOUNT_NOT_FOUND';
  if (source.status !== 'ACTIVE' || destination.status !== 'ACTIVE') return 'ACCOUNT_FROZEN';

  const value = BigInt(amount);
  const sourceBalance = BigInt(source.balance);
  if (sourceBalance < value) return 'INSUFFICIENT_FUNDS';

  accountsByUser.set(fromUserId, { ...source, balance: String(sourceBalance - value), updatedAt: committedAt });
  accountsByUser.set(toUserId, {
    ...destination,
    balance: String(BigInt(destination.balance) + value),
    updatedAt: committedAt,
  });
  return null;
}

export function openMockAccount(userId: string, accountName: string): { account: Account; created: boolean } {
  const existing = getMockAccount(userId);
  if (existing) return { account: existing, created: false };

  const openedAt = new Date().toISOString();
  const account: Account = {
    id: crypto.randomUUID(),
    userId,
    accountNumber: String(nextAccountNumber++),
    accountName,
    currency: 'VND',
    balance: '0',
    status: 'ACTIVE',
    createdAt: openedAt,
    updatedAt: openedAt,
  };

  accountsByUser.set(userId, account);
  return { account, created: true };
}
