import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RabbitMqService } from '../rabbitmq.service';
import { TransferPostedEvent } from '../events/transfer-posted.event';
import { TransferEntity } from '../../transfers/entities/transfer.entity';
import { ConsumerInboxEntity } from '../../common/entities/consumer-inbox.entity';

const QUEUE_NAME = 'transaction.projection.v1';
const ROUTING_KEY = 'transfer.posted';
const CONSUMER_NAME = 'transaction-projection';

/**
 * Transaction Consumer — Tuần 4
 *
 * Nghe sự kiện 'transfer.posted' từ RabbitMQ, chống xử lý trùng
 * qua consumer_inbox, cập nhật trạng thái transfer thành SUCCEEDED/REJECTED.
 *
 * Hợp đồng: E02 (Idempotent Consumer), E03 (Retry/DLQ)
 */
@Injectable()
export class TransferProjectionConsumer implements OnModuleInit {
  private readonly logger = new Logger(TransferProjectionConsumer.name);

  constructor(
    private readonly rabbitMqService: RabbitMqService,
    @InjectRepository(TransferEntity)
    private readonly transferRepo: Repository<TransferEntity>,
    @InjectRepository(ConsumerInboxEntity)
    private readonly inboxRepo: Repository<ConsumerInboxEntity>,
  ) {}

  async onModuleInit() {
    // Chờ vài tick để RabbitMqService.onModuleInit() hoàn thành kết nối trước
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

      // Prefetch 1 để xử lý tuần tự, tránh race condition trên consumer_inbox
      await channel.prefetch(1);

      await channel.consume(QUEUE_NAME, async (msg) => {
        if (!msg) return;

        try {
          const event = JSON.parse(msg.content.toString()) as TransferPostedEvent;
          await this.handleEvent(event);
          channel.ack(msg);
        } catch (err) {
          this.logger.error('Error processing TransferPosted event', err);
          // nack với requeue=false → đẩy vào DLQ
          channel.nack(msg, false, false);
        }
      });

      this.logger.log(`Consumer started on queue '${QUEUE_NAME}'`);
    } catch (err) {
      this.logger.error('Failed to setup TransferProjectionConsumer', err);
    }
  }

  private async handleEvent(event: TransferPostedEvent): Promise<void> {
    const { eventId, transferId, result, reasonCode, committedAt } = event;

    // E02 — Chống xử lý trùng qua consumer_inbox
    const existing = await this.inboxRepo.findOne({
      where: { consumerName: CONSUMER_NAME, eventId },
    });
    if (existing) {
      this.logger.log(`[E02] Duplicate event ${eventId} — skipped`);
      return;
    }

    // Ghi vào inbox trước (at-least-once → exactly-once)
    await this.inboxRepo.save(
      this.inboxRepo.create({ consumerName: CONSUMER_NAME, eventId }),
    );

    // Cập nhật trạng thái transfer
    const finalStatus = result === 'APPLIED' ? 'SUCCEEDED' : 'REJECTED';
    const committed =
      result === 'APPLIED'
        ? committedAt
          ? new Date(committedAt)
          : new Date()
        : null;

    await this.transferRepo.update(
      { id: transferId },
      {
        status: finalStatus,
        reasonCode: reasonCode ?? null,
        committedAt: committed,
        leaseUntil: null,
      },
    );

    this.logger.log(
      `[Projection] transferId=${transferId} → ${finalStatus} (event=${eventId})`,
    );
  }
}
