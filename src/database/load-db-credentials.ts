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

/** Loads .env and fetches DB credentials from Secrets Manager when needed. */
export async function ensureDbCredentials(): Promise<void> {
  loadEnvFile();

  if (process.env.DB_PASSWORD) {
    return;
  }

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
