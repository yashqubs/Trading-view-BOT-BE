import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AxiosError, AxiosRequestConfig } from 'axios';
import { firstValueFrom } from 'rxjs';
import { Direction } from '../common/enums';
import { SecretsService } from '../secrets/secrets.service';
import { IgApiException } from './ig-api.exception';
import {
  ClosePositionParams,
  ConfirmDealResult,
  IgMarket,
  IgMarketDetails,
  IgPosition,
  PlaceOrderParams,
  PlaceOrderResult,
} from './ig-client.types';

const SESSION_LIFETIME_MS = 4 * 60 * 60 * 1000; // IG session tokens are valid ~4 hours

// Transient errors only — 4xx auth/validation/business-rejections fail immediately,
// never retried, so a genuinely rejected trade is never silently retried into existing.
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_REQUEST_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 300;

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
    private readonly eventEmitter: EventEmitter2,
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
      this.emitSessionChanged();
    } catch (error) {
      this.session = null;
      this.emitSessionChanged();
      throw this.toIgApiException(error);
    }
  }

  // See trade.service.ts's emitTradeCreated for why this swallows errors —
  // a broadcast must never break session establishment/refresh.
  private emitSessionChanged(): void {
    try {
      this.eventEmitter.emit('ig.session.changed', { igConnected: this.isSessionActive() });
    } catch (error) {
      this.logger.warn(`Failed to emit ig.session.changed: ${(error as Error).message}`);
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

  async getMarketDetails(epic: string): Promise<IgMarketDetails> {
    await this.ensureSession();
    return this.request<IgMarketDetails>({ method: 'GET', url: `/markets/${epic}`, version: 3 });
  }

  // Spread bet account (see PROJECT_DOCUMENTATION.md Section 1) — expiry
  // must be 'DFB' (Daily Funded Bet, the non-expiring spread-bet product;
  // '-' is CFD-only and gets REJECT_CFD_ORDER_ON_SPREADBET_ACCOUNT).
  // currencyCode IS still required here (omitting it 400s with
  // "null-not-allowed.request.currencyCode") — it wasn't the cause of that
  // CFD rejection, expiry was.
  async placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResult> {
    await this.ensureSession();
    const orderType = params.orderType ?? 'MARKET';
    const data = {
      epic: params.epic,
      direction: params.direction,
      size: params.size,
      orderType,
      ...(orderType === 'LIMIT' ? { level: params.level } : {}),
      currencyCode: 'GBP',
      forceOpen: true,
      guaranteedStop: false,
      expiry: 'DFB',
    };
    return this.request<PlaceOrderResult>({
      method: 'POST',
      url: '/positions/otc',
      version: 2,
      data,
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
    const orderType = params.orderType ?? 'MARKET';
    const data = {
      dealId: params.dealId,
      direction: params.direction,
      size: params.size,
      orderType,
      ...(orderType === 'LIMIT' ? { level: params.level } : {}),
      expiry: 'DFB',
    };
    return this.request<PlaceOrderResult>({
      method: 'DELETE',
      url: '/positions/otc',
      version: 1,
      data,
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

    // IG's gateway drops the body of real DELETE requests (close-position
    // then 400s with validation.null-not-allowed.request). IG's documented
    // workaround: send POST with a _method: DELETE header instead.
    const isDeleteWithBody = options.method === 'DELETE' && options.data !== undefined;

    const config: AxiosRequestConfig = {
      method: isDeleteWithBody ? 'POST' : options.method,
      url: options.url,
      data: options.data,
      params: options.params,
      headers: {
        ...this.baseHeaders(options.version),
        CST: this.session.cst,
        'X-SECURITY-TOKEN': this.session.securityToken,
        ...(isDeleteWithBody ? { _method: 'DELETE' } : {}),
      },
    };

    for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
      try {
        const response = await firstValueFrom(this.httpService.request<T>(config));
        return response.data;
      } catch (error) {
        const status = (error as AxiosError).response?.status;
        const isRetryable = status !== undefined && RETRYABLE_STATUS_CODES.has(status);
        if (!isRetryable || attempt === MAX_REQUEST_ATTEMPTS) {
          throw this.toIgApiException(error);
        }
        this.logger.warn(
          `IG API ${options.method} ${options.url} failed with ${status}, retrying (attempt ${attempt}/${MAX_REQUEST_ATTEMPTS})`,
        );
        await this.delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }

    // Unreachable — the loop above always either returns or throws — but
    // keeps the function's return type honest for TypeScript.
    throw new IgApiException('UNKNOWN_ERROR');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
