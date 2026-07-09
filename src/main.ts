import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import helmet from 'helmet';

import { loadSecrets } from './config/secrets-manager';
import { buildCorsOptions, getFrontendOrigins, syncFrontendOrigin } from './config/cors-options';
import { loadEnvFile } from './database/load-env';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { ConfiguredSocketIoAdapter } from './realtime/configured-socket-io.adapter';
import { SecretsService } from './secrets/secrets.service';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  // PM2 only injects NODE_ENV — .env must be read before the AWS secrets bootstrap.
  loadEnvFile();

  if (process.env.SECRETS_SOURCE === 'aws') {
    const secretName = process.env.SECRET_NAME_APP;
    if (!secretName) {
      throw new Error('SECRET_NAME_APP is required when SECRETS_SOURCE=aws');
    }

    const secrets = await loadSecrets(secretName);
    Object.assign(process.env, secrets);
    logger.log(`Loaded secrets from ${secretName}`);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: true,
  });

  // Nginx terminates TLS on this same host and proxies over loopback. Without
  // this, req.ip is 127.0.0.1 for every request, so the per-IP throttler
  // (login lockout, refresh limit) lumps all users into one shared bucket.
  // 'loopback' trusts only that one hop — X-Forwarded-For values a client
  // sends directly are still ignored.
  app.set('trust proxy', 'loopback');

  const configService = app.get(ConfigService);
  const secretsService = app.get(SecretsService);
  await secretsService.ensureLoaded();
  syncFrontendOrigin(configService, secretsService);

  app.enableShutdownHooks();

  app.use(helmet());
  app.use(cookieParser());
  app.use(json({ limit: '10kb' }));

  app.setGlobalPrefix('api', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });

  const allowedOrigins = getFrontendOrigins(configService);
  if (allowedOrigins.length === 0) {
    logger.error('FRONTEND_ORIGIN is not set — browser requests will be blocked by CORS');
  } else {
    logger.log(`CORS allowed origins: ${allowedOrigins.join(', ')}`);
  }

  app.enableCors(buildCorsOptions(configService));

  app.useWebSocketAdapter(new ConfiguredSocketIoAdapter(app));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  const port = configService.get<number>('PORT', 3000);

  await app.listen(port);

  logger.log(`Trading bot backend listening on port ${port}`);
}

void bootstrap();
