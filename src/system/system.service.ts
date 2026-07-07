import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IgClientService } from '../ig-client/ig-client.service';
import { TradeService } from '../trade/trade.service';
import { SystemStatus } from './system.types';

@Injectable()
export class SystemService {
  constructor(
    private readonly configService: ConfigService,
    private readonly igClientService: IgClientService,
    private readonly tradeService: TradeService,
  ) {}

  async getStatus(): Promise<SystemStatus> {
    const baseUrl = this.configService.get<string>('PUBLIC_BASE_URL', '');
    return {
      webhookUrl: `${baseUrl}/api/webhook/signal`,
      igConnected: this.igClientService.isSessionActive(),
      igSessionExpiresAt: this.igClientService.getSessionExpiresAt(),
      lastSignalReceivedAt: await this.tradeService.getLastSignalReceivedAt(),
    };
  }
}
