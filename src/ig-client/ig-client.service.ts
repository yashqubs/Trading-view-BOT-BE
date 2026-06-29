import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosRequestConfig } from 'axios';
import { firstValueFrom } from 'rxjs';
import { Direction } from '../common/enums';
import { SecretsService } from '../secrets/secrets.service';
import { IgApiException } from './ig-api.exception';
import {
  ClosePositionParams,
  ConfirmDealResult,
  IgMarket,
  IgPosition,
  PlaceOrderParams,
  PlaceOrderResult,
} from './ig-client.types';

const SESSION_LIFETIME_MS = 4 * 60 * 60 * 1000; // IG session tokens are valid ~4 hours

interface IgSession {
  cst: string;
  securityToken: string;
  expiresAt: number;
}

interface IgPositionsResponse {
  positions: Array<{
    position: { dealId: string; size: number; direction: Direction };
    market: { epic: string };
  }>;
}

/**
 * The ONLY module permitted to call the IG REST API. All other modules go
 * through this service. See PROJECT_DOCUMENTATION.md Section 15 for the
 * exact endpoint contracts.
 */
@Injectable()
export class IgClientService {
  private readonly logger = new Logger(IgClientService.name);
  private session: IgSession | null = null;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly secretsService: SecretsService,
  ) {}

  isSessionActive(): boolean {
    return !!this.session && this.session.expiresAt > Date.now();
  }

  getSessionExpiresAt(): Date | null {
    return this.isSessionActive() ? new Date(this.session!.expiresAt) : null;
  }

  async refreshSession(): Promise<void> {
    await this.login();
  }

  async login(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          '/session',
          {
            identifier: this.secretsService.get('IG_USERNAME'),
            password: this.secretsService.get('IG_PASSWORD'),
          },
          { headers: this.baseHeaders(2) },
        ),
      );

      this.session = {
        cst: response.headers['cst'],
        securityToken: response.headers['x-security-token'],
        expiresAt: Date.now() + SESSION_LIFETIME_MS,
      };
      this.logger.log('IG session established');
    } catch (error) {
      this.session = null;
      throw this.toIgApiException(error);
    }
  }

  async searchMarkets(searchTerm: string): Promise<IgMarket[]> {
    await this.ensureSession();
    const response = await this.request<{ markets: IgMarket[] }>({
      method: 'GET',
      url: '/markets',
      params: { searchTerm },
      version: 1,
    });
    return response.markets;
  }

  async getMarketDetails(epic: string): Promise<IgMarket> {
    await this.ensureSession();
    return this.request<IgMarket>({ method: 'GET', url: `/markets/${epic}`, version: 3 });
  }

  async placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResult> {
    await this.ensureSession();
    return this.request<PlaceOrderResult>({
      method: 'POST',
      url: '/positions/otc',
      version: 2,
      data: {
        epic: params.epic,
        direction: params.direction,
        size: params.size,
        orderType: 'MARKET',
        currencyCode: 'GBP',
        forceOpen: true,
        guaranteedStop: false,
        expiry: '-',
      },
    });
  }

  async confirmDeal(dealReference: string): Promise<ConfirmDealResult> {
    await this.ensureSession();
    return this.request<ConfirmDealResult>({
      method: 'GET',
      url: `/confirms/${dealReference}`,
      version: 1,
    });
  }

  async getOpenPositions(): Promise<IgPosition[]> {
    await this.ensureSession();
    const response = await this.request<IgPositionsResponse>({
      method: 'GET',
      url: '/positions',
      version: 2,
    });

    return response.positions.map((entry) => ({
      dealId: entry.position.dealId,
      epic: entry.market.epic,
      direction: entry.position.direction,
      size: Number(entry.position.size),
    }));
  }

  async getOpenPositionCount(epic?: string): Promise<number> {
    const positions = await this.getOpenPositions();
    return epic ? positions.filter((position) => position.epic === epic).length : positions.length;
  }

  /**
   * `params.direction` must already be the opposite of the open position's
   * direction — callers (TradeModule) are responsible for computing that.
   */
  async closePosition(params: ClosePositionParams): Promise<PlaceOrderResult> {
    await this.ensureSession();
    return this.request<PlaceOrderResult>({
      method: 'DELETE',
      url: '/positions/otc',
      version: 1,
      data: {
        dealId: params.dealId,
        direction: params.direction,
        size: params.size,
        orderType: 'MARKET',
        expiry: '-',
      },
    });
  }

  async getAccounts(): Promise<unknown> {
    await this.ensureSession();
    return this.request({ method: 'GET', url: '/accounts', version: 1 });
  }

  async logout(): Promise<void> {
    if (!this.session) {
      return;
    }
    try {
      await this.request({ method: 'DELETE', url: '/session', version: 1 });
    } finally {
      this.session = null;
    }
  }

  private async ensureSession(): Promise<void> {
    if (!this.isSessionActive()) {
      await this.login();
    }
  }

  private async request<T>(options: {
    method: 'GET' | 'POST' | 'DELETE';
    url: string;
    version: number;
    data?: unknown;
    params?: Record<string, string>;
  }): Promise<T> {
    if (!this.session) {
      throw new IgApiException('NO_ACTIVE_SESSION');
    }

    const config: AxiosRequestConfig = {
      method: options.method,
      url: options.url,
      data: options.data,
      params: options.params,
      headers: {
        ...this.baseHeaders(options.version),
        CST: this.session.cst,
        'X-SECURITY-TOKEN': this.session.securityToken,
      },
    };

    try {
      const response = await firstValueFrom(this.httpService.request<T>(config));
      return response.data;
    } catch (error) {
      throw this.toIgApiException(error);
    }
  }

  private baseHeaders(version: number): Record<string, string> {
    return {
      'X-IG-API-KEY': this.secretsService.get('IG_API_KEY'),
      'Content-Type': 'application/json',
      Accept: 'application/json; charset=UTF-8',
      Version: String(version),
    };
  }

  private toIgApiException(error: unknown): IgApiException {
    const axiosError = error as AxiosError<{ errorCode?: string }>;
    const errorCode = axiosError?.response?.data?.errorCode ?? axiosError?.message ?? 'UNKNOWN';
    this.logger.error(`IG API call failed: ${errorCode}`);
    return new IgApiException(errorCode);
  }
}
