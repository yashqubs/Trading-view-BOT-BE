import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ConfigService } from '@nestjs/config';
import { SecretsService } from '../secrets/secrets.service';

export function getFrontendOrigins(configService: ConfigService): string[] {
  const raw =
    process.env.FRONTEND_ORIGIN?.trim() ||
    configService.get<string>('FRONTEND_ORIGIN')?.trim() ||
    '';

  if (!raw) {
    return [];
  }

  return normalizeOrigins(raw);
}

export function syncFrontendOrigin(
  configService: ConfigService,
  secretsService: SecretsService,
): void {
  if (process.env.FRONTEND_ORIGIN?.trim()) {
    return;
  }

  const fromConfig = configService.get<string>('FRONTEND_ORIGIN')?.trim();
  if (fromConfig) {
    process.env.FRONTEND_ORIGIN = fromConfig;
    return;
  }

  const fromSecrets = secretsService.getOptionalString('FRONTEND_ORIGIN')?.trim();
  if (fromSecrets) {
    process.env.FRONTEND_ORIGIN = fromSecrets;
  }
}

function normalizeOrigins(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(',')
        .map((origin) => origin.trim().replace(/\/$/, ''))
        .filter(Boolean),
    ),
  ];
}

export function buildCorsOptions(configService: ConfigService): CorsOptions {
  const allowed = getFrontendOrigins(configService);

  return {
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowed.length === 0) {
        callback(new Error('CORS blocked: FRONTEND_ORIGIN is not configured'));
        return;
      }

      const normalized = origin.replace(/\/$/, '');
      if (allowed.includes(normalized)) {
        callback(null, origin);
        return;
      }

      callback(new Error(`CORS blocked: origin ${origin} is not in FRONTEND_ORIGIN`));
    },
  };
}
