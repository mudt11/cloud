import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RabbitMqService } from './rabbitmq.service';
import { TransferProjectionConsumer } from './consumers/transfer-projection.consumer';
import { TransferEntity } from '../transfers/entities/transfer.entity';
import { ConsumerInboxEntity } from '../common/entities/consumer-inbox.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TransferEntity, ConsumerInboxEntity])],
  providers: [RabbitMqService, TransferProjectionConsumer],
  exports: [RabbitMqService],
})
export class RabbitMqModule {}
