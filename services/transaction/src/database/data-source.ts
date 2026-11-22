import { DataSource } from 'typeorm';
import * as path from 'node:path';
import { TransferEntity } from '../transfers/entities/transfer.entity';
import { ConsumerInboxEntity } from '../common/entities/consumer-inbox.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url:
    process.env.DATABASE_URL ||
    'postgresql://transaction_user:change_me@localhost:5432/transaction_db',
  entities: [TransferEntity, ConsumerInboxEntity],
  migrations: [path.join(__dirname, '../../migrations/*{.ts,.js}')],
  synchronize: false,
});
