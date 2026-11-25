import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransferController } from './transfer.controller';
import { TransferService } from './transfer.service';
import { AccountClient } from './account.client';
import { TransferRetryWorker } from './transfer-retry.worker';
import { TransferReconcileWorker } from './transfer-reconcile.worker';
import { TransferEntity } from './entities/transfer.entity';
import { ConsumerInboxEntity } from '../common/entities/consumer-inbox.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TransferEntity, ConsumerInboxEntity])],
  controllers: [TransferController],
  providers: [
    TransferService,
    AccountClient,
    TransferRetryWorker,
    TransferReconcileWorker,
  ],
  exports: [TransferService, AccountClient, TransferReconcileWorker],
})
export class TransfersModule {}
