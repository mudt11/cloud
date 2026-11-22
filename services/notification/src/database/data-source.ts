import { DataSource } from 'typeorm';
import * as path from 'node:path';
import { NotificationEntity } from '../notifications/entities/notification.entity';
import { ConsumerInboxEntity } from '../common/entities/consumer-inbox.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url:
    process.env.DATABASE_URL ||
    'postgresql://notification_user:change_me@localhost:5432/notification_db',
  entities: [NotificationEntity, ConsumerInboxEntity],
  migrations: [path.join(__dirname, '../../migrations/*{.ts,.js}')],
  synchronize: false,
});
