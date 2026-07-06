import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import helmet from 'helmet';

import { loadSecrets } from './config/secrets-manager';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { ConfiguredSocketIoAdapter } from './realtime/configured-socket-io.adapter';

async function bootstrap(): Promise<void> {
  if (process.env.SECRETS_SOURCE === 'aws') {
    const secrets = await loadSecrets(process.env.SECRET_NAME_APP!);

    Object.assign(process.env, secrets);
  }

  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
  });

  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.enableShutdownHooks();

  app.use(helmet());
  app.use(cookieParser());
  app.use(json({ limit: '10kb' }));

  app.setGlobalPrefix('api', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });
  app.enableCors({
    origin: configService.get<string>('FRONTEND_ORIGIN'),
    credentials: true,
  });

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
