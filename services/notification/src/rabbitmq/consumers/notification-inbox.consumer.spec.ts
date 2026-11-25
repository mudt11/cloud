import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  NotificationInboxConsumer,
  PermanentConsumerError,
} from './notification-inbox.consumer';
import { RabbitMqService } from '../rabbitmq.service';
import { NotificationEntity } from '../../notifications/entities/notification.entity';
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

describe('NotificationInboxConsumer (E01/E02)', () => {
  let consumer: NotificationInboxConsumer;
  let mockManager: any;
  let mockQb: any;
  let insertedNotifications: any[];

  beforeEach(async () => {
    insertedNotifications = [];

    mockQb = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn((v) => {
        if (Array.isArray(v)) insertedNotifications = v;
        return mockQb;
      }),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: [{ ok: 1 }] }),
    };

    mockManager = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQb),
      create: jest.fn((_entity, data) => data),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationInboxConsumer,
        { provide: RabbitMqService, useValue: { onReady: jest.fn() } },
        {
          provide: DataSource,
          useValue: { transaction: jest.fn(async (cb) => cb(mockManager)) },
        },
        { provide: getRepositoryToken(NotificationEntity), useValue: {} },
        { provide: getRepositoryToken(ConsumerInboxEntity), useValue: {} },
      ],
    }).compile();

    consumer = module.get<NotificationInboxConsumer>(
      NotificationInboxConsumer,
    );
  });

  it('should reject schemaVersion !== 1 with PermanentConsumerError', () => {
    expect(() =>
      consumer.validateEvent(makeEvent({ schemaVersion: 2 })),
    ).toThrow(PermanentConsumerError);
  });

  it('should create both OUTGOING and INCOMING notifications atomically in one transaction', async () => {
    const event = makeEvent();
    await consumer.handleEvent(event);

    expect(insertedNotifications).toHaveLength(2);
    expect(insertedNotifications[0]).toMatchObject({
      recipientUserId: event.payload.fromUserId,
      direction: 'OUTGOING',
      amount: '100000',
      type: 'TRANSFER_SUCCEEDED',
    });
    expect(insertedNotifications[1]).toMatchObject({
      recipientUserId: event.payload.toUserId,
      direction: 'INCOMING',
      amount: '100000',
      type: 'TRANSFER_SUCCEEDED',
    });
  });

  it('should skip duplicate eventId already recorded in consumer_inbox', async () => {
    mockQb.execute.mockResolvedValueOnce({ raw: [] });
    await consumer.handleEvent(makeEvent());

    expect(insertedNotifications).toHaveLength(0);
  });
});
