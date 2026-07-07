import { ensureDbCredentials } from './load-db-credentials';

async function revertMigration(): Promise<void> {
  await ensureDbCredentials();

  const { AppDataSource } = await import('./data-source');

  await AppDataSource.initialize();
  await AppDataSource.undoLastMigration();
  await AppDataSource.destroy();
}

revertMigration().catch((error: unknown) => {
  console.error('Error during migration revert:');
  console.error(error);
  process.exit(1);
});
