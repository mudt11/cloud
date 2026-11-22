import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TransferEntity } from '../transfers/entities/transfer.entity';
import { ConsumerInboxEntity } from '../common/entities/consumer-inbox.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url:
          configService.get<string>('DATABASE_URL') ||
          'postgresql://transaction_user:change_me@localhost:5432/transaction_db',
        entities: [TransferEntity, ConsumerInboxEntity],
        synchronize: false,
        retryAttempts: 1,
        retryDelay: 1000,
        autoLoadEntities: true,
      }),
    }),
    TypeOrmModule.forFeature([TransferEntity, ConsumerInboxEntity]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
