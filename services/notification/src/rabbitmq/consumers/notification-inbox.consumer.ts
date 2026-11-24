import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { RabbitMqService } from '../rabbitmq.service';
import { TransferPostedEvent } from '../events/transfer-posted.event';
import { NotificationEntity } from '../../notifications/entities/notification.entity';
import { ConsumerInboxEntity } from '../../common/entities/consumer-inbox.entity';

const QUEUE_NAME = 'notification.inbox.v1';
const ROUTING_KEY = 'transfer.posted';
const CONSUMER_NAME = 'notification-inbox';

/**
 * Notification Consumer — Tuần 4
 *
 * Nghe sự kiện 'transfer.posted', chống trùng qua consumer_inbox,
 * tạo 2 bản ghi notification: OUTGOING (người gửi) + INCOMING (người nhận).
 *
 * Hợp đồng: E02, N01 theo Tài liệu 06
 */
@Injectable()
export class NotificationInboxConsumer implements OnModuleInit {
  private readonly logger = new Logger(NotificationInboxConsumer.name);

  constructor(
    private readonly rabbitMqService: RabbitMqService,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepo: Repository<NotificationEntity>,
    @InjectRepository(ConsumerInboxEntity)
    private readonly inboxRepo: Repository<ConsumerInboxEntity>,
  ) {}

  async onModuleInit() {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await this.setupConsumer();
  }

  private async setupConsumer(): Promise<void> {
    try {
      await this.rabbitMqService.assertQueueWithDlq(QUEUE_NAME, ROUTING_KEY);
      const channel = this.rabbitMqService.getChannel();
      if (!channel) {
        this.logger.warn('No channel available — consumer not started');
        return;
      }

      await channel.prefetch(1);

      await channel.consume(QUEUE_NAME, async (msg) => {
        if (!msg) return;

        try {
          const event = JSON.parse(msg.content.toString()) as TransferPostedEvent;
          await this.handleEvent(event);
          channel.ack(msg);
        } catch (err) {
          this.logger.error('Error processing TransferPosted event', err);
          channel.nack(msg, false, false);
        }
      });

      this.logger.log(`Consumer started on queue '${QUEUE_NAME}'`);
    } catch (err) {
      this.logger.error('Failed to setup NotificationInboxConsumer', err);
    }
  }

  private async handleEvent(event: TransferPostedEvent): Promise<void> {
    // Chỉ tạo notification khi kết quả là APPLIED (chuyển tiền thành công)
    if (event.result !== 'APPLIED') {
      this.logger.log(
        `[E02] Skipping non-APPLIED event ${event.eventId} (result=${event.result})`,
      );
      return;
    }

    const { eventId } = event;

    // E02 — Chống xử lý trùng
    const existing = await this.inboxRepo.findOne({
      where: { consumerName: CONSUMER_NAME, eventId },
    });
    if (existing) {
      this.logger.log(`[E02] Duplicate event ${eventId} — skipped`);
      return;
    }

    await this.inboxRepo.save(
      this.inboxRepo.create({ consumerName: CONSUMER_NAME, eventId }),
    );

    // Tạo 2 bản ghi notification
    const outgoing = this.notificationRepo.create({
      id: randomUUID(),
      eventId,
      recipientUserId: event.fromUserId,
      type: 'TRANSFER_SUCCEEDED',
      transferId: event.transferId,
      direction: 'OUTGOING',
      amount: event.amount,
      currency: event.currency,
      message: this.buildOutgoingMessage(event),
      readAt: null,
    });

    const incoming = this.notificationRepo.create({
      id: randomUUID(),
      eventId,
      recipientUserId: event.toUserId,
      type: 'TRANSFER_SUCCEEDED',
      transferId: event.transferId,
      direction: 'INCOMING',
      amount: event.amount,
      currency: event.currency,
      message: this.buildIncomingMessage(event),
      readAt: null,
    });

    await this.notificationRepo.save([outgoing, incoming]);

    this.logger.log(
      `[Notification] Created OUTGOING+INCOMING for transferId=${event.transferId} (event=${eventId})`,
    );
  }

  private buildOutgoingMessage(event: TransferPostedEvent): string {
    const amount = Number(event.amount).toLocaleString('vi-VN');
    return `Bạn đã chuyển thành công ${amount} ${event.currency} đến tài khoản ${event.toAccountNumber}.`;
  }

  private buildIncomingMessage(event: TransferPostedEvent): string {
    const amount = Number(event.amount).toLocaleString('vi-VN');
    return `Bạn đã nhận ${amount} ${event.currency} từ tài khoản ${event.fromAccountNumber}.`;
  }
}
