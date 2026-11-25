import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqplib from 'amqplib';

export const EXCHANGE_NAME = 'bank.events.v1';
export const EXCHANGE_TYPE = 'topic';
export const TRANSFER_POSTED_ROUTING_KEY = 'transfer.posted.v1';
export const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000];

/**
 * RabbitMqService — Kết nối AMQP dùng ConfirmChannel cho Transaction Service.
 * Hỗ trợ reconnect tự động, khai báo queue/DLQ/retry queue theo Tài liệu 06 E02.
 */
@Injectable()
export class RabbitMqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqService.name);
  private model: amqplib.ChannelModel | null = null;
  private channel: amqplib.ConfirmChannel | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isClosing = false;
  private readonly onReadyCallbacks: Array<() => Promise<void>> = [];

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
      return;
    }
    await this.connect();
  }

  async onModuleDestroy() {
    this.isClosing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.close();
  }

  onReady(cb: () => Promise<void>): void {
    this.onReadyCallbacks.push(cb);
    if (this.isConnected()) {
      void cb();
    }
  }

  async connect(): Promise<void> {
    if (this.isClosing) return;

    const url =
      this.configService.get<string>('AMQP_URL') ||
      'amqp://guest:guest@localhost:5672';

    try {
      this.model = await amqplib.connect(url);
      this.channel = await this.model.createConfirmChannel();

      await this.channel.assertExchange(EXCHANGE_NAME, EXCHANGE_TYPE, {
        durable: true,
      });

      this.logger.log(`RabbitMQ connected and exchange '${EXCHANGE_NAME}' declared`);

      this.model.on('error', (err: Error) => {
        this.logger.error('RabbitMQ connection error', err);
      });

      this.model.on('close', () => {
        this.logger.warn('RabbitMQ connection closed');
        this.model = null;
        this.channel = null;
        this.scheduleReconnect();
      });

      for (const cb of this.onReadyCallbacks) {
        await cb().catch((err) =>
          this.logger.error('Error in RabbitMQ onReady callback', err),
        );
      }
    } catch (err) {
      this.logger.error('Failed to connect to RabbitMQ — retrying in 10s', err);
      this.model = null;
      this.channel = null;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.isClosing || this.reconnectTimer) return;
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, 10_000);
    this.reconnectTimer.unref?.();
  }

  async close(): Promise<void> {
    try {
      await this.channel?.close();
      await this.model?.close();
    } catch {
      // ignore
    } finally {
      this.channel = null;
      this.model = null;
    }
  }

  /**
   * Khai báo queue chính, DLQ (vd transaction.projection.dlq.v1) và retry queue (TTL dead-letter về queue chính).
   */
  async assertQueueTopology(
    queueName: string,
    dlqName: string,
    routingKey: string,
  ): Promise<void> {
    if (!this.channel) throw new Error('RabbitMQ channel not available');

    const retryQueueName = `${queueName}.retry`;

    // 1. DLQ durable riêng
    await this.channel.assertQueue(dlqName, { durable: true });

    // 2. Queue chính (durable) — dead-letter trỏ sang DLQ nếu bị nack(requeue=false)
    await this.channel.assertQueue(queueName, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': dlqName,
      },
    });

    // 3. Retry queue — mỗi message mang expiration (5s, 15s, 30s, 60s, 120s), hết hạn quay lại queue chính
    await this.channel.assertQueue(retryQueueName, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': queueName,
      },
    });

    await this.channel.bindQueue(queueName, EXCHANGE_NAME, routingKey);

    this.logger.log(
      `Topology ready: queue='${queueName}', retry='${retryQueueName}', dlq='${dlqName}', key='${routingKey}'`,
    );
  }

  /**
   * Republish có broker confirm sang retry queue hoặc DLQ trước khi ACK bản gốc (E02).
   */
  async sendToQueueWithConfirm(
    targetQueue: string,
    content: Buffer,
    options: amqplib.Options.Publish,
  ): Promise<void> {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not available');
    }
    const ch = this.channel;
    await new Promise<void>((resolve, reject) => {
      ch.sendToQueue(
        targetQueue,
        content,
        { persistent: true, contentType: 'application/json', ...options },
        (err) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });
  }

  getChannel(): amqplib.ConfirmChannel | null {
    return this.channel;
  }

  isConnected(): boolean {
    return this.model !== null && this.channel !== null;
  }
}
