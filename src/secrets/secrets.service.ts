import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { Injectable, InternalServerErrorException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { AppSecrets, IgSecrets, SecretKey } from './secrets.types';

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // re-fetch hourly to support rotation

const SECRET_KEYS: SecretKey[] = [
  'IG_API_KEY',
  'IG_USERNAME',
  'IG_PASSWORD',
  'DB_PASSWORD',
  'JWT_SECRET',
  'WEBHOOK_SECRET',
  'TOTP_ENCRYPTION_KEY',
];

/**
 * The only module permitted to talk to AWS Secrets Manager. Secrets are held
 * in memory only — never written to disk and never logged.
 *
 * Local development: set SECRETS_SOURCE=local in .env (development only) and
 * provide the secret keys as environment variables.
 */
@Injectable()
export class SecretsService implements OnModuleInit {
  private readonly logger = new Logger(SecretsService.name);
  private readonly client: SecretsManagerClient;
  private cache: Partial<IgSecrets & AppSecrets> = {};
  private loadPromise: Promise<void> | null = null;

  constructor(private readonly configService: ConfigService) {
    this.client = new SecretsManagerClient({
      region: this.configService.get<string>('AWS_REGION'),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.ensureLoaded();
  }

  /**
   * Other modules whose boot-time factories need a secret (e.g. DatabaseModule
   * needs DB_PASSWORD) must await this before reading — module instantiation
   * order alone does not guarantee the initial fetch has completed.
   */
  ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.refresh();
    }
    return this.loadPromise;
  }

  @Interval(REFRESH_INTERVAL_MS)
  async refresh(): Promise<void> {
    if (this.shouldUseLocalSecrets()) {
      this.cache = this.loadLocalSecrets();
      this.logger.log('Secrets loaded from local environment variables');
      return;
    }

    const igSecretName = this.configService.get<string>('SECRET_NAME_IG');
    const appSecretName = this.configService.get<string>('SECRET_NAME_APP');

    const [igSecrets, appSecrets] = await Promise.all([
      this.fetchSecret<IgSecrets>(igSecretName),
      this.fetchSecret<AppSecrets>(appSecretName),
    ]);

    this.cache = { ...igSecrets, ...appSecrets };
    this.logger.log('Secrets refreshed from AWS Secrets Manager');
  }

  get(key: SecretKey): string {
    const value = this.cache[key];
    if (!value) {
      throw new InternalServerErrorException(`Secret ${key} is not available`);
    }
    return value;
  }

  private shouldUseLocalSecrets(): boolean {
    const source = this.configService.get<string>('SECRETS_SOURCE');
    if (source !== 'local') {
      return false;
    }

    if (this.configService.get<string>('NODE_ENV') === 'production') {
      throw new InternalServerErrorException('SECRETS_SOURCE=local is not allowed in production');
    }

    return true;
  }

  private loadLocalSecrets(): IgSecrets & AppSecrets {
    const missing: SecretKey[] = [];

    const secrets = SECRET_KEYS.reduce<Partial<IgSecrets & AppSecrets>>((accumulator, key) => {
      const value = process.env[key];
      if (!value) {
        missing.push(key);
        return accumulator;
      }
      accumulator[key] = value;
      return accumulator;
    }, {});

    if (missing.length > 0) {
      throw new InternalServerErrorException(
        `Missing local secrets in environment: ${missing.join(', ')}`,
      );
    }

    return secrets as IgSecrets & AppSecrets;
  }

  private async fetchSecret<T>(secretName: string | undefined): Promise<Partial<T>> {
    if (!secretName) {
      return {};
    }
    try {
      const response = await this.client.send(new GetSecretValueCommand({ SecretId: secretName }));
      return response.SecretString ? (JSON.parse(response.SecretString) as T) : {};
    } catch (error) {
      this.logger.error(
        `Failed to fetch secret ${secretName}`,
        error instanceof Error ? error.message : String(error),
      );
      throw new InternalServerErrorException('Unable to load required secrets');
    }
  }
}
