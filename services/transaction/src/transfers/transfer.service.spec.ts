import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TransferService } from './transfer.service';
import { AccountClient } from './account.client';
import { TransferEntity } from './entities/transfer.entity';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { AuthenticatedUser } from '../common/guards/jwt-auth.guard';
import {
  IdempotencyConflictException,
  ForbiddenException,
  ResourceNotFoundException,
} from '../common/exceptions/app.exception';

const MOCK_USER_CUSTOMER: AuthenticatedUser = {
  sub: '11111111-1111-4111-8111-111111111111',
  role: 'CUSTOMER',
};

const MOCK_USER_ADMIN: AuthenticatedUser = {
  sub: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  role: 'ADMIN',
};

const MOCK_CONTEXT = {
  fromAccountId: '22222222-2222-4222-8222-222222222222',
  fromAccountNumber: '1234567890',
  fromUserId: MOCK_USER_CUSTOMER.sub,
  toAccountId: '33333333-3333-4333-8333-333333333333',
  toAccountNumber: '0987654321',
  toUserId: '44444444-4444-4444-8444-444444444444',
};

const MOCK_DTO: CreateTransferDto = {
  fromAccountId: MOCK_CONTEXT.fromAccountId,
  toAccountNumber: MOCK_CONTEXT.toAccountNumber,
  amount: '100000',
  description: 'Thanh toán tiền thuê',
};

function makeTransferEntity(overrides: Partial<TransferEntity> = {}): TransferEntity {
  return {
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    requesterUserId: MOCK_USER_CUSTOMER.sub,
    idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    requestHash: 'abc123',
    fromAccountId: MOCK_CONTEXT.fromAccountId,
    toAccountId: MOCK_CONTEXT.toAccountId,
    fromAccountNumber: MOCK_CONTEXT.fromAccountNumber,
    toAccountNumber: MOCK_CONTEXT.toAccountNumber,
    fromUserId: MOCK_CONTEXT.fromUserId,
    toUserId: MOCK_CONTEXT.toUserId,
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

  beforeEach(async () => {
    mockTransferRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    mockAccountClient = {
      getTransferContext: jest.fn(),
      createPosting: jest.fn(),
      getPostingStatus: jest.fn(),
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
        .mockResolvedValueOnce(null) // idempotency check → not found
        .mockResolvedValueOnce(makeTransferEntity({ status: 'SUCCEEDED', committedAt: new Date() })); // after update

      mockAccountClient.getTransferContext.mockResolvedValue(MOCK_CONTEXT);
      mockAccountClient.createPosting.mockResolvedValue({
        result: 'APPLIED',
        committedAt: new Date().toISOString(),
      });

      mockTransferRepo.create.mockReturnValue(makeTransferEntity());
      mockTransferRepo.save.mockResolvedValue(makeTransferEntity());
      mockTransferRepo.update.mockResolvedValue(undefined);

      const result = await service.create(
        MOCK_DTO,
        idempotencyKey,
        MOCK_USER_CUSTOMER,
        requestId,
      );

      expect(result.replayed).toBe(false);
      expect(result.pending).toBe(false);
      expect(result.transfer.status).toBe('SUCCEEDED');
      expect(mockAccountClient.getTransferContext).toHaveBeenCalledWith(
        {
          fromAccountId: MOCK_DTO.fromAccountId,
          toAccountNumber: MOCK_DTO.toAccountNumber,
          requesterUserId: MOCK_USER_CUSTOMER.sub,
        },
        requestId,
      );
      expect(mockAccountClient.createPosting).toHaveBeenCalled();
    });

    it('should create a REJECTED transfer when Account responds REJECTED', async () => {
      mockTransferRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeTransferEntity({ status: 'REJECTED', reasonCode: 'M05' }));

      mockAccountClient.getTransferContext.mockResolvedValue(MOCK_CONTEXT);
      mockAccountClient.createPosting.mockResolvedValue({
        result: 'REJECTED',
        reasonCode: 'M05',
      });

      mockTransferRepo.create.mockReturnValue(makeTransferEntity());
      mockTransferRepo.save.mockResolvedValue(makeTransferEntity());
      mockTransferRepo.update.mockResolvedValue(undefined);

      const result = await service.create(
        MOCK_DTO,
        idempotencyKey,
        MOCK_USER_CUSTOMER,
        requestId,
      );

      expect(result.pending).toBe(false);
      expect(result.transfer.status).toBe('REJECTED');
      expect(result.transfer.reasonCode).toBe('M05');
    });

    it('should return pending=true when Account times out (I02 returns null)', async () => {
      mockTransferRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeTransferEntity({ status: 'PENDING' }));

      mockAccountClient.getTransferContext.mockResolvedValue(MOCK_CONTEXT);
      mockAccountClient.createPosting.mockResolvedValue(null); // timeout

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

    it('should return replayed=true when idempotency key already exists with same hash', async () => {
      const existingTransfer = makeTransferEntity({ status: 'SUCCEEDED' });
      // Compute same hash as service would
      const hash = require('node:crypto')
        .createHash('sha256')
        .update(JSON.stringify({
          fromAccountId: MOCK_DTO.fromAccountId,
          toAccountNumber: MOCK_DTO.toAccountNumber,
          amount: MOCK_DTO.amount,
          description: MOCK_DTO.description ?? '',
        }))
        .digest('hex');
      existingTransfer.requestHash = hash;

      mockTransferRepo.findOne.mockResolvedValueOnce(existingTransfer);

      const result = await service.create(
        MOCK_DTO,
        idempotencyKey,
        MOCK_USER_CUSTOMER,
        requestId,
      );

      expect(result.replayed).toBe(true);
      expect(mockAccountClient.getTransferContext).not.toHaveBeenCalled();
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
        sub: MOCK_CONTEXT.toUserId,
        role: 'CUSTOMER',
      };
      const transfer = makeTransferEntity({
        status: 'SUCCEEDED',
        toUserId: MOCK_CONTEXT.toUserId,
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

    it('should throw ForbiddenException when CUSTOMER tries to view unrelated transfer', async () => {
      const transfer = makeTransferEntity({
        requesterUserId: 'other-user',
        toUserId: 'yet-another-user',
        status: 'PENDING',
      });
      mockTransferRepo.findOne.mockResolvedValue(transfer);

      await expect(
        service.findOne(transferId, MOCK_USER_CUSTOMER),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
