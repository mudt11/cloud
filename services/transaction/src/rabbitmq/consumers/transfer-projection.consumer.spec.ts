import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  TransferProjectionConsumer,
  PermanentConsumerError,
} from './transfer-projection.consumer';
import { RabbitMqService } from '../rabbitmq.service';
import { TransferEntity } from '../../transfers/entities/transfer.entity';
import { ConsumerInboxEntity } from '../../common/entities/consumer-inbox.entity';
import { TransferPostedEvent } from '../events/transfer-posted.event';

function makeEvent(
  overrides: Partial<TransferPostedEvent> = {},
): TransferPostedEvent {
  return {
    eventId: '44444444-4444-4444-8444-444444444444',
    eventType: 'TransferPosted',
    schemaVersion: 1,
    occurredAt: '2026-11-02T03:00:00.000Z',
    producer: 'account',
    correlationId: '33333333-3333-4333-8333-333333333333',
    payload: {
      transferId: '33333333-3333-4333-8333-333333333333',
      requesterUserId: '11111111-1111-4111-8111-111111111111',
      fromAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      toAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      fromUserId: '11111111-1111-4111-8111-111111111111',
      toUserId: '22222222-2222-4222-8222-222222222222',
      fromAccountNumber: '1000000001',
      toAccountNumber: '1000000002',
      amount: '100000',
      currency: 'VND',
      description: 'Chuyen tien',
      committedAt: '2026-11-02T03:00:00.000Z',
    },
    ...overrides,
  };
}

describe('TransferProjectionConsumer (E01/E02)', () => {
  let consumer: TransferProjectionConsumer;
  let mockManager: any;
  let mockInsertQb: any;

  beforeEach(async () => {
    mockInsertQb = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: [{ event_id: '44444444-4444-4444-8444-444444444444' }] }),
    };

    mockManager = {
      createQueryBuilder: jest.fn().mockReturnValue(mockInsertQb),
      findOne: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransferProjectionConsumer,
        { provide: RabbitMqService, useValue: { onReady: jest.fn() } },
        {
          provide: DataSource,
          useValue: { transaction: jest.fn(async (cb) => cb(mockManager)) },
        },
        { provide: getRepositoryToken(TransferEntity), useValue: {} },
        { provide: getRepositoryToken(ConsumerInboxEntity), useValue: {} },
      ],
    }).compile();

    consumer = module.get<TransferProjectionConsumer>(
      TransferProjectionConsumer,
    );
  });

  it('should reject schemaVersion !== 1 with PermanentConsumerError', () => {
    expect(() =>
      consumer.validateEvent(makeEvent({ schemaVersion: 2 })),
    ).toThrow(PermanentConsumerError);
  });

  it('should update PENDING transfer to SUCCEEDED in transaction', async () => {
    const event = makeEvent();
    mockManager.findOne.mockResolvedValue({
      id: event.payload.transferId,
      requesterUserId: event.payload.requesterUserId,
      fromAccountId: event.payload.fromAccountId,
      toAccountId: event.payload.toAccountId,
      amount: event.payload.amount,
      status: 'PENDING',
    });

    await consumer.handleEvent(event);

    expect(mockManager.update).toHaveBeenCalledWith(
      TransferEntity,
      { id: event.payload.transferId, status: 'PENDING' },
      expect.objectContaining({ status: 'SUCCEEDED', leaseUntil: null }),
    );
  });

  it('should skip duplicate eventId already recorded in consumer_inbox', async () => {
    mockInsertQb.execute.mockResolvedValue({ raw: [] });
    await consumer.handleEvent(makeEvent());

    expect(mockManager.findOne).not.toHaveBeenCalled();
    expect(mockManager.update).not.toHaveBeenCalled();
  });

  it('should throw PermanentConsumerError if existing transfer is REJECTED (E02 inconsistency)', async () => {
    const event = makeEvent();
    mockManager.findOne.mockResolvedValue({
      id: event.payload.transferId,
      requesterUserId: event.payload.requesterUserId,
      fromAccountId: event.payload.fromAccountId,
      toAccountId: event.payload.toAccountId,
      amount: event.payload.amount,
      status: 'REJECTED',
    });

    await expect(consumer.handleEvent(event)).rejects.toThrow(
      PermanentConsumerError,
    );
  });
});
