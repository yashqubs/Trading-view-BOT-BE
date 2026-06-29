import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IgClientService } from '../ig-client/ig-client.service';
import { SystemStatus } from './system.types';

@Injectable()
export class SystemService {
  constructor(
    private readonly configService: ConfigService,
    private readonly igClientService: IgClientService,
  ) {}

  getStatus(): SystemStatus {
    const baseUrl = this.configService.get<string>('PUBLIC_BASE_URL', '');
    return {
      webhookUrl: `${baseUrl}/webhook/signal`,
      igConnected: this.igClientService.isSessionActive(),
      igSessionExpiresAt: this.igClientService.getSessionExpiresAt(),
    };
  }
}
