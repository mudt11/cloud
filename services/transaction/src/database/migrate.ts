import { AppDataSource } from './data-source';

async function runMigrations() {
  console.log('Connecting to database for migrations...');
  await AppDataSource.initialize();
  console.log('Running pending migrations...');
  const migrations = await AppDataSource.runMigrations();
  if (migrations.length === 0) {
    console.log('No new migrations to run.');
  } else {
    console.log(
      `Executed ${migrations.length} migration(s):`,
      migrations.map((m) => m.name),
    );
  }
  await AppDataSource.destroy();
  console.log('Migrations completed successfully.');
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
