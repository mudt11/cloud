import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import * as amqplib from 'amqplib';
import {
  RabbitMqService,
  TRANSFER_POSTED_ROUTING_KEY,
  RETRY_DELAYS_MS,
} from '../rabbitmq.service';
import { TransferPostedEvent } from '../events/transfer-posted.event';
import { NotificationEntity } from '../../notifications/entities/notification.entity';
import { ConsumerInboxEntity } from '../../common/entities/consumer-inbox.entity';

export const NOTIFICATION_QUEUE = 'notification.inbox.v1';
export const NOTIFICATION_DLQ = 'notification.inbox.dlq.v1';
export const NOTIFICATION_RETRY_QUEUE = `${NOTIFICATION_QUEUE}.retry`;
const CONSUMER_NAME = 'notification-inbox';

export class PermanentConsumerError extends Error {}

/**
 * Notification Consumer — Tài liệu 06 E01, E02 & N01
 *
 * - Exchange bank.events.v1, routing key transfer.posted.v1
 * - Queue notification.inbox.v1, DLQ notification.inbox.dlq.v1
 * - Trong cùng 1 DB transaction: chèn consumer_inbox + tạo 2 thông báo OUTGOING và INCOMING
 * - Lỗi tạm thời: retry sau 5, 15, 30, 60, 120s (tổng 6 lần) rồi mới vào DLQ
 */
@Injectable()
export class NotificationInboxConsumer implements OnModuleInit {
  private readonly logger = new Logger(NotificationInboxConsumer.name);

  constructor(
    private readonly rabbitMqService: RabbitMqService,
    private readonly dataSource: DataSource,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepo: Repository<NotificationEntity>,
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
        NOTIFICATION_QUEUE,
        NOTIFICATION_DLQ,
        TRANSFER_POSTED_ROUTING_KEY,
      );
      const channel = this.rabbitMqService.getChannel();
      if (!channel) {
        this.logger.warn('No channel available — consumer not started');
        return;
      }

      await channel.prefetch(1);

      await channel.consume(NOTIFICATION_QUEUE, async (msg) => {
        if (!msg) return;
        await this.processMessage(msg, channel);
      });

      this.logger.log(`Consumer started on queue '${NOTIFICATION_QUEUE}'`);
    } catch (err) {
      this.logger.error('Failed to setup NotificationInboxConsumer', err);
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
          NOTIFICATION_RETRY_QUEUE,
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
    if (
      !event.eventId ||
      !event.payload ||
      !event.payload.transferId ||
      !event.payload.fromUserId ||
      !event.payload.toUserId ||
      !event.payload.amount
    ) {
      throw new PermanentConsumerError('Missing required fields in TransferPosted');
    }
  }

  async handleEvent(event: TransferPostedEvent): Promise<void> {
    const { eventId, payload } = event;

    await this.dataSource.transaction(async (manager) => {
      // 1. Ghi consumer_inbox idempotent trong cùng transaction với 2 thông báo
      const inboxInsert = await manager
        .createQueryBuilder()
        .insert()
        .into(ConsumerInboxEntity)
        .values({ consumerName: CONSUMER_NAME, eventId })
        .orIgnore()
        .execute();

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

      const outgoing = manager.create(NotificationEntity, {
        id: randomUUID(),
        eventId,
        recipientUserId: payload.fromUserId,
        type: 'TRANSFER_SUCCEEDED',
        transferId: payload.transferId,
        direction: 'OUTGOING',
        amount: payload.amount,
        currency: payload.currency || 'VND',
        message: this.buildOutgoingMessage(
          payload.amount,
          payload.currency || 'VND',
          payload.toAccountNumber,
        ),
        readAt: null,
      });

      const incoming = manager.create(NotificationEntity, {
        id: randomUUID(),
        eventId,
        recipientUserId: payload.toUserId,
        type: 'TRANSFER_SUCCEEDED',
        transferId: payload.transferId,
        direction: 'INCOMING',
        amount: payload.amount,
        currency: payload.currency || 'VND',
        message: this.buildIncomingMessage(
          payload.amount,
          payload.currency || 'VND',
          payload.fromAccountNumber,
        ),
        readAt: null,
      });

      await manager
        .createQueryBuilder()
        .insert()
        .into(NotificationEntity)
        .values([outgoing, incoming])
        .orIgnore()
        .execute();

      this.logger.log(
        `[Notification] Created OUTGOING+INCOMING for transferId=${payload.transferId} (event=${eventId})`,
      );
    });
  }

  private formatVnd(amount: string): string {
    try {
      return new Intl.NumberFormat('vi-VN').format(BigInt(amount));
    } catch {
      return amount;
    }
  }

  private buildOutgoingMessage(
    amount: string,
    currency: string,
    toAccountNumber: string,
  ): string {
    return `Bạn đã chuyển ${this.formatVnd(amount)} ${currency} đến tài khoản ${toAccountNumber}`;
  }

  private buildIncomingMessage(
    amount: string,
    currency: string,
    fromAccountNumber: string,
  ): string {
    return `Bạn đã nhận ${this.formatVnd(amount)} ${currency} từ tài khoản ${fromAccountNumber}`;
  }
}
