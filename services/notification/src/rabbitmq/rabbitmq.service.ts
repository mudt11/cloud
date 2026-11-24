import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqplib from 'amqplib';

export const EXCHANGE_NAME = 'bank.events.v1';
export const EXCHANGE_TYPE = 'topic';

/**
 * RabbitMqService — Kết nối AMQP cho Notification Service.
 * Khai báo exchange 'bank.events.v1' (topic, durable).
 */
@Injectable()
export class RabbitMqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqService.name);
  private model: amqplib.ChannelModel | null = null;
  private channel: amqplib.Channel | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.close();
  }

  async connect(): Promise<void> {
    const url =
      this.configService.get<string>('AMQP_URL') ||
      'amqp://guest:guest@localhost:5672';

    try {
      this.model = await amqplib.connect(url);
      this.channel = await this.model.createChannel();

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
      });
    } catch (err) {
      this.logger.error('Failed to connect to RabbitMQ', err);
      this.model = null;
      this.channel = null;
    }
  }

  async close(): Promise<void> {
    try {
      await this.channel?.close();
      await this.model?.close();
    } catch {
      // ignore
    }
  }

  async assertQueueWithDlq(
    queueName: string,
    routingKey: string,
  ): Promise<void> {
    if (!this.channel) throw new Error('RabbitMQ channel not available');

    const dlqName = `${queueName}.dlq`;
    await this.channel.assertQueue(dlqName, { durable: true });
    await this.channel.assertQueue(queueName, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': dlqName,
        'x-message-ttl': 86_400_000,
      },
    });

    await this.channel.bindQueue(queueName, EXCHANGE_NAME, routingKey);
    this.logger.log(`Queue '${queueName}' declared (DLQ: '${dlqName}', routing: '${routingKey}')`);
  }

  getChannel(): amqplib.Channel | null {
    return this.channel;
  }

  isConnected(): boolean {
    return this.model !== null && this.channel !== null;
  }
}
