import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { TransferController } from './transfer.controller';
import { TransferService } from './transfer.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { ValidationException } from '../common/exceptions/app.exception';

const MOCK_USER = {
  sub: '11111111-1111-4111-8111-111111111111',
  role: 'CUSTOMER' as const,
};

const VALID_IDEMPOTENCY_KEY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQUEST_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const MOCK_TRANSFER = {
  id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  requesterUserId: MOCK_USER.sub,
  fromAccountId: '22222222-2222-4222-8222-222222222222',
  toAccountId: '33333333-3333-4333-8333-333333333333',
  fromAccountNumber: '1000000001',
  toAccountNumber: '1000000002',
  amount: '100000',
  currency: 'VND',
  description: 'Test transfer',
  status: 'SUCCEEDED' as const,
  reasonCode: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  committedAt: '2026-11-01T10:00:01.000Z',
};

function makeReq(headersOverride: Record<string, string> = {}) {
  return {
    user: MOCK_USER,
    requestId: REQUEST_ID,
    query: {},
    headers: {
      'idempotency-key': VALID_IDEMPOTENCY_KEY,
      authorization: 'Bearer token',
      ...headersOverride,
    },
  };
}

function makeRes() {
  const headers: Record<string, string> = {};
  return {
    status: jest.fn().mockReturnThis(),
    setHeader: jest.fn((k: string, v: string) => {
      headers[k] = v;
    }),
    _headers: headers,
  };
}

describe('TransferController', () => {
  let controller: TransferController;
  let mockTransferService: any;

  beforeEach(async () => {
    mockTransferService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransferController],
      providers: [{ provide: TransferService, useValue: mockTransferService }],
    }).compile();

    controller = module.get<TransferController>(TransferController);
  });

  describe('createTransfer (T01)', () => {
    const dto: CreateTransferDto = {
      fromAccountId: '22222222-2222-4222-8222-222222222222',
      toAccountNumber: '1000000002',
      amount: '100000',
      description: 'Test',
    };

    it('should return HTTP 201 Created with Location & Idempotency-Replayed: false', async () => {
      mockTransferService.create.mockResolvedValue({
        transfer: MOCK_TRANSFER,
        replayed: false,
        pending: false,
      });

      const req = makeReq() as any;
      const res = makeRes() as any;

      const result = await controller.createTransfer(dto, req, res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.CREATED);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Location',
        `/api/v1/transfers/${MOCK_TRANSFER.id}`,
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Idempotency-Replayed',
        'false',
      );
      expect(result.data.id).toBe(MOCK_TRANSFER.id);
      expect(result.requestId).toBe(REQUEST_ID);
    });

    it('should return HTTP 200 with Idempotency-Replayed: true for replay', async () => {
      mockTransferService.create.mockResolvedValue({
        transfer: MOCK_TRANSFER,
        replayed: true,
        pending: false,
      });

      const req = makeReq() as any;
      const res = makeRes() as any;

      const result = await controller.createTransfer(dto, req, res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Idempotency-Replayed',
        'true',
      );
      expect(result.data.id).toBe(MOCK_TRANSFER.id);
    });

    it('should return HTTP 202 with Location and Retry-After when pending', async () => {
      mockTransferService.create.mockResolvedValue({
        transfer: { ...MOCK_TRANSFER, status: 'PENDING', committedAt: null },
        replayed: false,
        pending: true,
      });

      const req = makeReq() as any;
      const res = makeRes() as any;

      await controller.createTransfer(dto, req, res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '2');
    });

    it('should throw ValidationException (400) when Idempotency-Key header is missing', async () => {
      const req = {
        user: MOCK_USER,
        requestId: REQUEST_ID,
        query: {},
        headers: {},
      } as any;
      const res = makeRes() as any;

      await expect(
        controller.createTransfer(dto, req, res),
      ).rejects.toThrow(ValidationException);
    });

    it('should throw ValidationException (400) when Idempotency-Key is not UUID v4', async () => {
      const req = makeReq({ 'idempotency-key': 'not-valid-uuid' }) as any;
      const res = makeRes() as any;

      await expect(
        controller.createTransfer(dto, req, res),
      ).rejects.toThrow(ValidationException);
    });
  });

  describe('listTransfers (T02)', () => {
    it('should return 200 with items and meta', async () => {
      mockTransferService.findAll.mockResolvedValue({
        items: [MOCK_TRANSFER],
        meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
      });

      const req = makeReq() as any;
      const result = await controller.listTransfers(
        { page: 1, pageSize: 20 },
        req,
      );

      expect(result.data.items).toHaveLength(1);
      expect(result.meta.totalItems).toBe(1);
      expect(result.requestId).toBe(REQUEST_ID);
    });
  });

  describe('getTransfer (T03)', () => {
    const transferId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

    it('should return 200 with transfer data', async () => {
      mockTransferService.findOne.mockResolvedValue(MOCK_TRANSFER);

      const req = makeReq() as any;
      const res = makeRes() as any;
      const result = await controller.getTransfer(transferId, req, res);

      expect(result.data).toEqual(MOCK_TRANSFER);
      expect(result.requestId).toBe(REQUEST_ID);
    });

    it('should include Retry-After: 2 when transfer status is PENDING', async () => {
      mockTransferService.findOne.mockResolvedValue({
        ...MOCK_TRANSFER,
        status: 'PENDING',
        committedAt: null,
      });

      const req = makeReq() as any;
      const res = makeRes() as any;
      await controller.getTransfer(transferId, req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '2');
    });
  });
});
