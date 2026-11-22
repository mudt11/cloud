import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationEntity } from '../notifications/entities/notification.entity';
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
          'postgresql://notification_user:change_me@localhost:5432/notification_db',
        entities: [NotificationEntity, ConsumerInboxEntity],
        synchronize: false,
        retryAttempts: 1,
        retryDelay: 1000,
        autoLoadEntities: true,
      }),
    }),
    TypeOrmModule.forFeature([NotificationEntity, ConsumerInboxEntity]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
