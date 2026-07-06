import { ensureDbCredentials } from './load-db-credentials';

async function runMigrations(): Promise<void> {
  await ensureDbCredentials();

  const { AppDataSource } = await import('./data-source');

  await AppDataSource.initialize();
  await AppDataSource.runMigrations();
  await AppDataSource.destroy();
}

runMigrations().catch((error: unknown) => {
  console.error('Error during migration run:');
  console.error(error);
  process.exit(1);
});
