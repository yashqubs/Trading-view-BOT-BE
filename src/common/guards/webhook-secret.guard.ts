import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { SecretsService } from '../../secrets/secrets.service';

@Injectable()
export class WebhookSecretGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSecretGuard.name);

  constructor(private readonly secretsService: SecretsService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const providedSecret = request.body?.secret;
    const expectedSecret = this.secretsService.get('WEBHOOK_SECRET');

    if (
      typeof providedSecret !== 'string' ||
      providedSecret.length === 0 ||
      providedSecret !== expectedSecret
    ) {
      this.logger.warn('Rejected webhook with invalid secret');
      throw new UnauthorizedException('Invalid webhook secret');
    }

    return true;
  }
}
