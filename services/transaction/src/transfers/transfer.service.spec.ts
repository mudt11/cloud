import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createHash } from 'node:crypto';
import { TransferService } from './transfer.service';
import { AccountClient } from './account.client';
import { TransferEntity } from './entities/transfer.entity';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { AuthenticatedUser } from '../common/guards/jwt-auth.guard';
import {
  IdempotencyConflictException,
  ResourceNotFoundException,
  ValidationException,
} from '../common/exceptions/app.exception';

const MOCK_USER_CUSTOMER: AuthenticatedUser = {
  sub: '11111111-1111-4111-8111-111111111111',
  role: 'CUSTOMER',
};

const MOCK_USER_ADMIN: AuthenticatedUser = {
  sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  role: 'ADMIN',
};

const MOCK_CONTEXT_RESPONSE = {
  from: {
    id: '22222222-2222-4222-8222-222222222222',
    userId: MOCK_USER_CUSTOMER.sub,
    accountNumber: '1000000001',
    accountName: 'Nguyen Van A',
    currency: 'VND',
    status: 'ACTIVE' as const,
  },
  to: {
    id: '33333333-3333-4333-8333-333333333333',
    userId: '44444444-4444-4444-8444-444444444444',
    accountNumber: '1000000002',
    accountName: 'Nguyen Van B',
    currency: 'VND',
    status: 'ACTIVE' as const,
  },
};

const MOCK_DTO: CreateTransferDto = {
  fromAccountId: MOCK_CONTEXT_RESPONSE.from.id,
  toAccountNumber: MOCK_CONTEXT_RESPONSE.to.accountNumber,
  amount: '100000',
  description: 'Thanh toán tiền thuê',
};

function makeTransferEntity(
  overrides: Partial<TransferEntity> = {},
): TransferEntity {
  return {
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    requesterUserId: MOCK_USER_CUSTOMER.sub,
    idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    requestHash: 'abc123',
    fromAccountId: MOCK_CONTEXT_RESPONSE.from.id,
    toAccountId: MOCK_CONTEXT_RESPONSE.to.id,
    fromAccountNumber: MOCK_CONTEXT_RESPONSE.from.accountNumber,
    toAccountNumber: MOCK_CONTEXT_RESPONSE.to.accountNumber,
    fromUserId: MOCK_CONTEXT_RESPONSE.from.userId,
    toUserId: MOCK_CONTEXT_RESPONSE.to.userId,
    amount: '100000',
    currency: 'VND',
    description: 'Thanh toán tiền thuê',
    status: 'PENDING',
    reasonCode: null,
    createdAt: new Date('2026-11-01T10:00:00Z'),
    updatedAt: new Date('2026-11-01T10:00:00Z'),
    committedAt: null,
    leaseUntil: new Date(Date.now() + 30000),
    ...overrides,
  } as TransferEntity;
}

describe('TransferService', () => {
  let service: TransferService;
  let mockTransferRepo: any;
  let mockAccountClient: any;
  let mockQb: any;

  beforeEach(async () => {
    mockQb = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    mockTransferRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQb),
    };

    mockAccountClient = {
      getTransferContext: jest.fn(),
      createPosting: jest.fn(),
      getPostingStatus: jest.fn(),
      getMyAccount: jest.fn(),
      getAdminAccountById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransferService,
        { provide: getRepositoryToken(TransferEntity), useValue: mockTransferRepo },
        { provide: AccountClient, useValue: mockAccountClient },
        { provide: DataSource, useValue: {} },
      ],
    }).compile();

    service = module.get<TransferService>(TransferService);
  });

  describe('create (T01)', () => {
    const idempotencyKey = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const requestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

    it('should create a new SUCCEEDED transfer when Account responds APPLIED', async () => {
      mockTransferRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          makeTransferEntity({ status: 'SUCCEEDED', committedAt: new Date() }),
        );

      mockAccountClient.getTransferContext.mockResolvedValue(
        MOCK_CONTEXT_RESPONSE,
      );
      mockAccountClient.createPosting.mockResolvedValue({
        transferId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        status: 'APPLIED',
        reasonCode: null,
        committedAt: new Date().toISOString(),
      });

      mockTransferRepo.create.mockReturnValue(makeTransferEntity());
      mockTransferRepo.save.mockResolvedValue(makeTransferEntity());
      mockTransferRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.create(
        MOCK_DTO,
        idempotencyKey,
        MOCK_USER_CUSTOMER,
        requestId,
      );

      expect(result.replayed).toBe(false);
      expect(result.pending).toBe(false);
      expect(result.transfer.status).toBe('SUCCEEDED');
      expect(result.transfer.requesterUserId).toBe(MOCK_USER_CUSTOMER.sub);
      expect((result.transfer as any).fromUserId).toBeUndefined();
      expect(mockAccountClient.getTransferContext).toHaveBeenCalledWith(
        {
          requesterUserId: MOCK_USER_CUSTOMER.sub,
          fromAccountId: MOCK_DTO.fromAccountId,
          toAccountNumber: MOCK_DTO.toAccountNumber,
        },
        requestId,
      );
      expect(mockAccountClient.createPosting).toHaveBeenCalledWith(
        expect.objectContaining({
          requesterUserId: MOCK_USER_CUSTOMER.sub,
          fromAccountId: MOCK_CONTEXT_RESPONSE.from.id,
          toAccountId: MOCK_CONTEXT_RESPONSE.to.id,
          amount: '100000',
          currency: 'VND',
        }),
        requestId,
        2_000,
      );
    });

    it('should create a REJECTED transfer when Account responds REJECTED', async () => {
      mockTransferRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          makeTransferEntity({
            status: 'REJECTED',
            reasonCode: 'INSUFFICIENT_FUNDS',
          }),
        );

      mockAccountClient.getTransferContext.mockResolvedValue(
        MOCK_CONTEXT_RESPONSE,
      );
      mockAccountClient.createPosting.mockResolvedValue({
        status: 'REJECTED',
        reasonCode: 'INSUFFICIENT_FUNDS',
        committedAt: null,
      });

      mockTransferRepo.create.mockReturnValue(makeTransferEntity());
      mockTransferRepo.save.mockResolvedValue(makeTransferEntity());
      mockTransferRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.create(
        MOCK_DTO,
        idempotencyKey,
        MOCK_USER_CUSTOMER,
        requestId,
      );

      expect(result.pending).toBe(false);
      expect(result.transfer.status).toBe('REJECTED');
      expect(result.transfer.reasonCode).toBe('INSUFFICIENT_FUNDS');
    });

    it('should return pending=true when Account times out (I02 returns null)', async () => {
      mockTransferRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeTransferEntity({ status: 'PENDING' }));

      mockAccountClient.getTransferContext.mockResolvedValue(
        MOCK_CONTEXT_RESPONSE,
      );
      mockAccountClient.createPosting.mockResolvedValue(null);

      mockTransferRepo.create.mockReturnValue(makeTransferEntity());
      mockTransferRepo.save.mockResolvedValue(makeTransferEntity());

      const result = await service.create(
        MOCK_DTO,
        idempotencyKey,
        MOCK_USER_CUSTOMER,
        requestId,
      );

      expect(result.pending).toBe(true);
      expect(result.transfer.status).toBe('PENDING');
    });

    it('should return replayed=true, pending=true when replaying a still-PENDING transfer', async () => {
      const existingTransfer = makeTransferEntity({ status: 'PENDING' });
      existingTransfer.requestHash = createHash('sha256')
        .update(
          JSON.stringify({
            fromAccountId: MOCK_DTO.fromAccountId,
            toAccountNumber: MOCK_DTO.toAccountNumber,
            amount: MOCK_DTO.amount,
            description: MOCK_DTO.description ?? '',
          }),
        )
        .digest('hex');

      mockTransferRepo.findOne.mockResolvedValueOnce(existingTransfer);

      const result = await service.create(
        MOCK_DTO,
        idempotencyKey,
        MOCK_USER_CUSTOMER,
        requestId,
      );

      expect(result.replayed).toBe(true);
      expect(result.pending).toBe(true);
      expect(mockAccountClient.getTransferContext).not.toHaveBeenCalled();
    });

    it('should handle unique violation (23505) on concurrent same-key requests', async () => {
      const hash = service.computeRequestHash(MOCK_DTO);
      const winner = makeTransferEntity({ status: 'SUCCEEDED', requestHash: hash });

      mockTransferRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(winner);
      mockAccountClient.getTransferContext.mockResolvedValue(
        MOCK_CONTEXT_RESPONSE,
      );
      mockTransferRepo.create.mockReturnValue(makeTransferEntity());
      mockTransferRepo.save.mockRejectedValueOnce({ code: '23505' });

      const result = await service.create(
        MOCK_DTO,
        idempotencyKey,
        MOCK_USER_CUSTOMER,
        requestId,
      );

      expect(result.replayed).toBe(true);
      expect(result.pending).toBe(false);
      expect(mockAccountClient.createPosting).not.toHaveBeenCalled();
    });

    it('should throw IdempotencyConflictException when same key with different body', async () => {
      const existingTransfer = makeTransferEntity();
      existingTransfer.requestHash = 'different_hash_000';
      mockTransferRepo.findOne.mockResolvedValueOnce(existingTransfer);

      await expect(
        service.create(MOCK_DTO, idempotencyKey, MOCK_USER_CUSTOMER, requestId),
      ).rejects.toThrow(IdempotencyConflictException);
    });
  });

  describe('findAll (T02)', () => {
    const authHeader = 'Bearer test.jwt';
    const requestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

    it('should return paginated list with meta for CUSTOMER', async () => {
      const entity = makeTransferEntity({ status: 'SUCCEEDED' });
      mockQb.getManyAndCount.mockResolvedValue([[entity], 1]);

      const result = await service.findAll(
        MOCK_USER_CUSTOMER,
        { page: 1, pageSize: 20 },
        authHeader,
        requestId,
      );

      expect(result.items).toHaveLength(1);
      expect(result.meta).toEqual({
        page: 1,
        pageSize: 20,
        totalItems: 1,
        totalPages: 1,
      });
      expect(mockQb.andWhere).toHaveBeenCalledWith(
        '(t.requester_user_id = :userId OR (t.to_user_id = :userId AND t.status = :succeededStatus))',
        { userId: MOCK_USER_CUSTOMER.sub, succeededStatus: 'SUCCEEDED' },
      );
    });

    it('should throw ValidationException when only fromDate is provided without toDate', async () => {
      await expect(
        service.findAll(
          MOCK_USER_CUSTOMER,
          { fromDate: '2026-11-01' },
          authHeader,
          requestId,
        ),
      ).rejects.toThrow(ValidationException);
    });

    it('should throw ValidationException when direction is provided without accountId', async () => {
      await expect(
        service.findAll(
          MOCK_USER_CUSTOMER,
          { direction: 'OUTGOING' },
          authHeader,
          requestId,
        ),
      ).rejects.toThrow(ValidationException);
    });

    it('should throw ResourceNotFoundException when CUSTOMER filters by accountId they do not own', async () => {
      mockAccountClient.getMyAccount.mockResolvedValue({
        id: '99999999-9999-4999-8999-999999999999',
      });

      await expect(
        service.findAll(
          MOCK_USER_CUSTOMER,
          { accountId: MOCK_CONTEXT_RESPONSE.from.id },
          authHeader,
          requestId,
        ),
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should verify accountId via A05 when user is ADMIN', async () => {
      mockAccountClient.getAdminAccountById.mockResolvedValue({
        id: MOCK_CONTEXT_RESPONSE.from.id,
      });
      mockQb.getManyAndCount.mockResolvedValue([[], 0]);

      const result = await service.findAll(
        MOCK_USER_ADMIN,
        {
          accountId: MOCK_CONTEXT_RESPONSE.from.id,
          direction: 'INCOMING',
        },
        authHeader,
        requestId,
      );

      expect(mockAccountClient.getAdminAccountById).toHaveBeenCalledWith(
        authHeader,
        MOCK_CONTEXT_RESPONSE.from.id,
        requestId,
      );
      expect(result.meta.totalPages).toBe(0);
    });
  });

  describe('findOne (T03)', () => {
    const transferId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

    it('should return transfer when requester is owner', async () => {
      const transfer = makeTransferEntity({
        requesterUserId: MOCK_USER_CUSTOMER.sub,
        status: 'SUCCEEDED',
      });
      mockTransferRepo.findOne.mockResolvedValue(transfer);

      const result = await service.findOne(transferId, MOCK_USER_CUSTOMER);
      expect(result.id).toBe(transfer.id);
    });

    it('should return SUCCEEDED transfer when user is recipient', async () => {
      const recipientUser: AuthenticatedUser = {
        sub: MOCK_CONTEXT_RESPONSE.to.userId,
        role: 'CUSTOMER',
      };
      const transfer = makeTransferEntity({
        status: 'SUCCEEDED',
        toUserId: MOCK_CONTEXT_RESPONSE.to.userId,
        requesterUserId: 'other-user-id',
      });
      mockTransferRepo.findOne.mockResolvedValue(transfer);

      const result = await service.findOne(transferId, recipientUser);
      expect(result.id).toBe(transfer.id);
    });

    it('should return any transfer when user is ADMIN', async () => {
      const transfer = makeTransferEntity({
        requesterUserId: 'some-other-user',
      });
      mockTransferRepo.findOne.mockResolvedValue(transfer);

      const result = await service.findOne(transferId, MOCK_USER_ADMIN);
      expect(result.id).toBe(transfer.id);
    });

    it('should throw ResourceNotFoundException when transfer does not exist', async () => {
      mockTransferRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findOne(transferId, MOCK_USER_CUSTOMER),
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should throw ResourceNotFoundException (404) when CUSTOMER tries to view unrelated or PENDING incoming transfer', async () => {
      const transfer = makeTransferEntity({
        requesterUserId: 'other-user',
        toUserId: MOCK_USER_CUSTOMER.sub,
        status: 'PENDING',
      });
      mockTransferRepo.findOne.mockResolvedValue(transfer);

      await expect(
        service.findOne(transferId, MOCK_USER_CUSTOMER),
      ).rejects.toThrow(ResourceNotFoundException);
    });
  });
});
