import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as amqplib from 'amqplib';
import {
  RabbitMqService,
  TRANSFER_POSTED_ROUTING_KEY,
  RETRY_DELAYS_MS,
} from '../rabbitmq.service';
import { TransferPostedEvent } from '../events/transfer-posted.event';
import { TransferEntity } from '../../transfers/entities/transfer.entity';
import { ConsumerInboxEntity } from '../../common/entities/consumer-inbox.entity';

export const TRANSACTION_QUEUE = 'transaction.projection.v1';
export const TRANSACTION_DLQ = 'transaction.projection.dlq.v1';
export const TRANSACTION_RETRY_QUEUE = `${TRANSACTION_QUEUE}.retry`;
const CONSUMER_NAME = 'transaction-projection';

export class PermanentConsumerError extends Error {}

/**
 * Transaction Consumer — Tài liệu 06 E01 & E02
 *
 * - Exchange bank.events.v1, routing key transfer.posted.v1
 * - Queue transaction.projection.v1, DLQ transaction.projection.dlq.v1
 * - Chống xử lý trùng qua consumer_inbox trong cùng DB transaction
 * - Kiểm tra schemaVersion === 1, immutable fields, bất nhất REJECTED
 * - Lỗi tạm thời: retry sau 5, 15, 30, 60, 120s (tối đa 6 lần thử) rồi mới vào DLQ
 */
@Injectable()
export class TransferProjectionConsumer implements OnModuleInit {
  private readonly logger = new Logger(TransferProjectionConsumer.name);

  constructor(
    private readonly rabbitMqService: RabbitMqService,
    private readonly dataSource: DataSource,
    @InjectRepository(TransferEntity)
    private readonly transferRepo: Repository<TransferEntity>,
    @InjectRepository(ConsumerInboxEntity)
    private readonly inboxRepo: Repository<ConsumerInboxEntity>,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
      return;
    }
    this.rabbitMqService.onReady(() => this.setupConsumer());
  }

  private async setupConsumer(): Promise<void> {
    try {
      await this.rabbitMqService.assertQueueTopology(
        TRANSACTION_QUEUE,
        TRANSACTION_DLQ,
        TRANSFER_POSTED_ROUTING_KEY,
      );
      const channel = this.rabbitMqService.getChannel();
      if (!channel) {
        this.logger.warn('No channel available — consumer not started');
        return;
      }

      await channel.prefetch(1);

      await channel.consume(TRANSACTION_QUEUE, async (msg) => {
        if (!msg) return;
        await this.processMessage(msg, channel);
      });

      this.logger.log(`Consumer started on queue '${TRANSACTION_QUEUE}'`);
    } catch (err) {
      this.logger.error('Failed to setup TransferProjectionConsumer', err);
    }
  }

  private async processMessage(
    msg: amqplib.ConsumeMessage,
    channel: amqplib.ConfirmChannel,
  ): Promise<void> {
    let event: TransferPostedEvent;
    try {
      event = JSON.parse(msg.content.toString('utf8')) as TransferPostedEvent;
    } catch (err) {
      this.logger.error('Invalid JSON in TransferPosted message -> DLQ', err);
      channel.nack(msg, false, false);
      return;
    }

    try {
      this.validateEvent(event);
      await this.handleEvent(event);
      channel.ack(msg);
    } catch (err) {
      if (err instanceof PermanentConsumerError) {
        this.logger.error(
          `[E02] Permanent error for event=${event?.eventId}: ${err.message} -> DLQ`,
        );
        channel.nack(msg, false, false);
        return;
      }

      const headers = msg.properties.headers || {};
      const retryCount = Number(headers['x-retry-count'] || 0);

      if (retryCount >= RETRY_DELAYS_MS.length) {
        this.logger.error(
          `[E02] Exhausted ${retryCount + 1} attempts for event=${event?.eventId} -> DLQ`,
          err,
        );
        channel.nack(msg, false, false);
        return;
      }

      const delayMs = RETRY_DELAYS_MS[retryCount];
      try {
        await this.rabbitMqService.sendToQueueWithConfirm(
          TRANSACTION_RETRY_QUEUE,
          msg.content,
          {
            expiration: String(delayMs),
            messageId: msg.properties.messageId,
            headers: {
              ...headers,
              'x-retry-count': retryCount + 1,
            },
          },
        );
        // Chỉ ACK bản gốc sau khi đã confirm bản retry nằm trên broker (E02)
        channel.ack(msg);
        this.logger.warn(
          `[E02] Scheduled retry #${retryCount + 1} in ${delayMs / 1000}s for event=${event?.eventId}`,
        );
      } catch (publishErr) {
        this.logger.error(
          `[E02] Failed to schedule retry for event=${event?.eventId} -> requeue`,
          publishErr,
        );
        channel.nack(msg, false, true);
      }
    }
  }

  validateEvent(event: TransferPostedEvent): void {
    if (!event || typeof event !== 'object') {
      throw new PermanentConsumerError('Event body must be an object');
    }
    if (event.schemaVersion !== 1) {
      throw new PermanentConsumerError(
        `Unsupported schemaVersion=${String(event.schemaVersion)}`,
      );
    }
    if (event.eventType !== 'TransferPosted') {
      throw new PermanentConsumerError(
        `Unexpected eventType=${String(event.eventType)}`,
      );
    }
    if (!event.eventId || !event.payload || !event.payload.transferId) {
      throw new PermanentConsumerError('Missing eventId or payload.transferId');
    }
    if (!event.payload.committedAt) {
      throw new PermanentConsumerError('TransferPosted missing committedAt');
    }
  }

  async handleEvent(event: TransferPostedEvent): Promise<void> {
    const { eventId, payload } = event;

    await this.dataSource.transaction(async (manager) => {
      // 1. Ghi consumer_inbox idempotent trong cùng transaction DB
      const inboxInsert = await manager
        .createQueryBuilder()
        .insert()
        .into(ConsumerInboxEntity)
        .values({ consumerName: CONSUMER_NAME, eventId })
        .orIgnore()
        .execute();

      // TypeORM Postgres returns identifiers / raw row count; fallback check if affected === 0
      const insertedRows =
        Array.isArray(inboxInsert.raw) ? inboxInsert.raw.length : undefined;
      const alreadyExists =
        insertedRows === 0 ||
        (typeof inboxInsert.raw?.rowCount === 'number' &&
          inboxInsert.raw.rowCount === 0);

      if (alreadyExists) {
        this.logger.log(`[E02] Duplicate event ${eventId} — skipped`);
        return;
      }

      // 2. Đọc bản ghi transfer đã tiếp nhận
      const transfer = await manager.findOne(TransferEntity, {
        where: { id: payload.transferId },
      });

      if (!transfer) {
        // Không tự tạo mới (E02 dòng 636) -> đưa vào DLQ để đối chiếu receipt
        throw new PermanentConsumerError(
          `Transfer ${payload.transferId} not found in transaction_db`,
        );
      }

      // 3. Kiểm tra immutable fields khớp bản ghi đã tiếp nhận
      const immutableMatch =
        transfer.amount === payload.amount &&
        transfer.fromAccountId === payload.fromAccountId &&
        transfer.toAccountId === payload.toAccountId &&
        transfer.requesterUserId === payload.requesterUserId;

      if (!immutableMatch) {
        throw new PermanentConsumerError(
          `Immutable field mismatch for transferId=${payload.transferId}`,
        );
      }

      // 4. Bất nhất: đang REJECTED mà nhận TransferPosted -> cảnh báo & giữ DLQ (E02 dòng 635)
      if (transfer.status === 'REJECTED') {
        throw new PermanentConsumerError(
          `Inconsistent state: transfer ${payload.transferId} is REJECTED but received TransferPosted`,
        );
      }

      // 5. Đã SUCCEEDED -> giữ nguyên
      if (transfer.status === 'SUCCEEDED') {
        this.logger.log(
          `[Projection] transferId=${payload.transferId} already SUCCEEDED (event=${eventId})`,
        );
        return;
      }

      // 6. PENDING -> SUCCEEDED
      await manager.update(
        TransferEntity,
        { id: payload.transferId, status: 'PENDING' },
        {
          status: 'SUCCEEDED',
          reasonCode: null,
          committedAt: new Date(payload.committedAt),
          leaseUntil: null,
        },
      );

      this.logger.log(
        `[Projection] transferId=${payload.transferId} -> SUCCEEDED (event=${eventId})`,
      );
    });
  }
}
