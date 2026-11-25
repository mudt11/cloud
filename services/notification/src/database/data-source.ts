import { DataSource, MigrationInterface } from 'typeorm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NotificationEntity } from '../notifications/entities/notification.entity';
import { ConsumerInboxEntity } from '../common/entities/consumer-inbox.entity';

function loadMigrations(): Array<new () => MigrationInterface> {
  const isCompiled = __filename.endsWith('.js');
  const migrationsDir = path.resolve(__dirname, '../../migrations');
  if (!fs.existsSync(migrationsDir)) return [];

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) =>
      isCompiled ? f.endsWith('.js') : f.endsWith('.ts') && !f.endsWith('.d.ts'),
    )
    .sort();

  const classes: Array<new () => MigrationInterface> = [];
  for (const file of files) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(path.join(migrationsDir, file)) as Record<string, any>;
    for (const exported of Object.values(mod)) {
      if (typeof exported === 'function') {
        classes.push(exported as new () => MigrationInterface);
      }
    }
  }
  return classes;
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  url:
    process.env.DATABASE_URL ||
    'postgresql://notification_user:change_me@localhost:5432/notification_db',
  entities: [NotificationEntity, ConsumerInboxEntity],
  migrations: loadMigrations(),
  synchronize: false,
});
