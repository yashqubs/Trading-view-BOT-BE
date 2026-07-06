import { loadSecrets } from '../config/secrets-manager';
import { loadEnvFile } from './load-env';

async function runMigrations(): Promise<void> {
  loadEnvFile();

  if (!process.env.DB_PASSWORD) {
    const secretName = process.env.SECRET_NAME_APP;
    if (!secretName) {
      throw new Error('DB_PASSWORD is not set and SECRET_NAME_APP is missing from .env');
    }

    const secrets = await loadSecrets(secretName) as Record<string, unknown>;
    if (typeof secrets.DB_PASSWORD !== 'string' || !secrets.DB_PASSWORD) {
      throw new Error(`DB_PASSWORD not found in secret ${secretName}`);
    }

    process.env.DB_PASSWORD = secrets.DB_PASSWORD;

    if (!process.env.DB_USERNAME && typeof secrets.DB_USERNAME === 'string' && secrets.DB_USERNAME) {
      process.env.DB_USERNAME = secrets.DB_USERNAME;
    }
  }

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
