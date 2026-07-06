import { loadSecrets } from '../config/secrets-manager';
import { loadEnvFile } from './load-env';

const DB_CONFIG_KEYS = ['DB_USERNAME', 'DB_NAME', 'DB_HOST', 'DB_PORT'] as const;

function applyDbConfigFromSecrets(secrets: Record<string, unknown>): void {
  if (typeof secrets.DB_PASSWORD === 'string' && secrets.DB_PASSWORD) {
    process.env.DB_PASSWORD = secrets.DB_PASSWORD;
  }

  for (const key of DB_CONFIG_KEYS) {
    const value = secrets[key];
    if (!process.env[key] && typeof value === 'string' && value) {
      process.env[key] = value;
    }
  }
}

async function runMigrations(): Promise<void> {
  loadEnvFile();

  if (!process.env.DB_PASSWORD) {
    const secretName = process.env.SECRET_NAME_APP;
    if (!secretName) {
      throw new Error('DB_PASSWORD is not set and SECRET_NAME_APP is missing from .env');
    }

    const secrets = (await loadSecrets(secretName)) as Record<string, unknown>;
    if (typeof secrets.DB_PASSWORD !== 'string' || !secrets.DB_PASSWORD) {
      throw new Error(`DB_PASSWORD not found in secret ${secretName}`);
    }

    applyDbConfigFromSecrets(secrets);
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
