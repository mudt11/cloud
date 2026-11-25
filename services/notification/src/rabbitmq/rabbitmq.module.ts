import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RabbitMqService } from './rabbitmq.service';
import { NotificationInboxConsumer } from './consumers/notification-inbox.consumer';
import { NotificationEntity } from '../notifications/entities/notification.entity';
import { ConsumerInboxEntity } from '../common/entities/consumer-inbox.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([NotificationEntity, ConsumerInboxEntity])],
  providers: [RabbitMqService, NotificationInboxConsumer],
  exports: [RabbitMqService],
})
export class RabbitMqModule {}
