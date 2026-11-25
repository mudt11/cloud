import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TransferRetryWorker } from './transfer-retry.worker';
import { TransferReconcileWorker } from './transfer-reconcile.worker';
import { AccountClient } from './account.client';
import { TransferEntity } from './entities/transfer.entity';

function makePendingTransfer(
  overrides: Partial<TransferEntity> = {},
): TransferEntity {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    requesterUserId: '11111111-1111-4111-8111-111111111111',
    idempotencyKey: '66666666-6666-4666-8666-666666666666',
    requestHash: 'hash',
    fromAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    toAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    fromAccountNumber: '1000000001',
    toAccountNumber: '1000000002',
    fromUserId: '11111111-1111-4111-8111-111111111111',
    toUserId: '22222222-2222-4222-8222-222222222222',
    amount: '100000',
    currency: 'VND',
    description: 'Chuyen tien',
    status: 'PENDING',
    reasonCode: null,
    createdAt: new Date('2026-11-02T03:00:00.000Z'),
    updatedAt: new Date('2026-11-02T03:00:00.000Z'),
    committedAt: null,
    leaseUntil: new Date(Date.now() - 1000),
    ...overrides,
  } as TransferEntity;
}

describe('TransferRetryWorker & TransferReconcileWorker (T01b / E03)', () => {
  let retryWorker: TransferRetryWorker;
  let reconcileWorker: TransferReconcileWorker;
  let mockRepo: any;
  let mockAccountClient: any;

  beforeEach(async () => {
    const mockUpdateQb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    mockRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue(mockUpdateQb),
    };

    mockAccountClient = {
      getPostingStatus: jest.fn(),
      createPosting: jest.fn(),
      listPostings: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransferRetryWorker,
        TransferReconcileWorker,
        { provide: getRepositoryToken(TransferEntity), useValue: mockRepo },
        { provide: AccountClient, useValue: mockAccountClient },
      ],
    }).compile();

    retryWorker = module.get<TransferRetryWorker>(TransferRetryWorker);
    reconcileWorker = module.get<TransferReconcileWorker>(
      TransferReconcileWorker,
    );
  });

  describe('TransferRetryWorker', () => {
    it('should update transfer to SUCCEEDED when I03 returns APPLIED receipt', async () => {
      const pending = makePendingTransfer();
      mockAccountClient.getPostingStatus.mockResolvedValue({
        found: true,
        receipt: {
          transferId: pending.id,
          status: 'APPLIED',
          reasonCode: null,
          committedAt: '2026-11-02T03:00:00.000Z',
        },
      });

      await retryWorker.processOne(pending);

      expect(mockAccountClient.createPosting).not.toHaveBeenCalled();
      expect(mockRepo.update).toHaveBeenCalledWith(
        { id: pending.id, status: 'PENDING' },
        expect.objectContaining({
          status: 'SUCCEEDED',
          reasonCode: null,
          leaseUntil: null,
        }),
      );
    });

    it('should retry I02 when I03 returns 404 POSTING_NOT_FOUND (not auto-REJECTED)', async () => {
      const pending = makePendingTransfer();
      mockAccountClient.getPostingStatus.mockResolvedValue({
        found: false,
        notFound: true,
      });
      mockAccountClient.createPosting.mockResolvedValue({
        transferId: pending.id,
        status: 'APPLIED',
        reasonCode: null,
        committedAt: '2026-11-02T03:00:05.000Z',
      });

      await retryWorker.processOne(pending);

      expect(mockAccountClient.createPosting).toHaveBeenCalledWith(
        expect.objectContaining({
          transferId: pending.id,
          requesterUserId: pending.requesterUserId,
          amount: '100000',
        }),
        expect.any(String),
        10_000,
      );
      expect(mockRepo.update).toHaveBeenCalledWith(
        { id: pending.id, status: 'PENDING' },
        expect.objectContaining({ status: 'SUCCEEDED', leaseUntil: null }),
      );
    });

    it('should keep PENDING and schedule backoff when Account unreachable', async () => {
      const pending = makePendingTransfer();
      mockAccountClient.getPostingStatus.mockResolvedValue({
        found: false,
        notFound: false,
      });

      await retryWorker.processOne(pending);

      expect(mockAccountClient.createPosting).not.toHaveBeenCalled();
      expect(mockRepo.update).toHaveBeenCalledWith(
        { id: pending.id, status: 'PENDING' },
        expect.objectContaining({ leaseUntil: expect.any(Date) }),
      );
    });
  });

  describe('TransferReconcileWorker (E03 / I04)', () => {
    it('should scan all pages via I04 cursor, resolve PENDING, and report discrepancies', async () => {
      const t1 = makePendingTransfer({ id: '11111111-1111-4111-8111-111111111111', status: 'PENDING' });
      const t2 = makePendingTransfer({ id: '22222222-2222-4222-8222-222222222222', status: 'SUCCEEDED' });

      mockAccountClient.listPostings
        .mockResolvedValueOnce({
          items: [
            {
              transferId: t1.id,
              requesterUserId: t1.requesterUserId,
              fromAccountId: t1.fromAccountId,
              toAccountId: t1.toAccountId,
              amount: t1.amount,
              status: 'APPLIED',
              reasonCode: null,
              committedAt: '2026-11-02T03:00:00.000Z',
            },
            {
              transferId: t2.id,
              requesterUserId: t2.requesterUserId,
              fromAccountId: t2.fromAccountId,
              toAccountId: t2.toAccountId,
              amount: t2.amount,
              status: 'APPLIED',
              reasonCode: null,
              committedAt: '2026-11-02T03:00:00.000Z',
            },
          ],
          meta: { limit: 200, nextCursor: 'cursor-1', hasMore: true },
        })
        .mockResolvedValueOnce({
          items: [
            {
              transferId: '99999999-9999-4999-8999-999999999999',
              requesterUserId: t1.requesterUserId,
              fromAccountId: t1.fromAccountId,
              toAccountId: t1.toAccountId,
              amount: '100000',
              status: 'APPLIED',
              reasonCode: null,
              committedAt: '2026-11-02T03:00:00.000Z',
            },
          ],
          meta: { limit: 200, nextCursor: null, hasMore: false },
        });

      mockRepo.findOne
        .mockResolvedValueOnce(t1)
        .mockResolvedValueOnce(t2)
        .mockResolvedValueOnce(null);

      const summary = await reconcileWorker.reconcileAll();

      expect(summary.scannedReceipts).toBe(3);
      expect(summary.updatedPending).toBe(1);
      expect(summary.alreadyMatched).toBe(1);
      expect(summary.missingTransfers).toEqual([
        '99999999-9999-4999-8999-999999999999',
      ]);
      expect(summary.statusConflicts).toEqual([]);
      expect(summary.immutableMismatches).toEqual([]);
    });
  });
});
