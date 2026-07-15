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
  IgDebugEntry,
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

  // Dev-only raw request/response capture for the test-signal endpoint (see
  // Section 9 "Dev Test Signal Endpoint" + startRecording doc below) — null
  // means "not recording," so normal webhook trades never pay any cost here.
  private debugRecorder: IgDebugEntry[] | null = null;

  /** Starts capturing every raw IG HTTP exchange from here until
   * stopRecording() is called. Always resets to an empty list, even if a
   * previous recording was left running — safe because this is only ever
   * driven by one awaited test-signal request at a time (single PM2 fork
   * instance, JwtAuthGuard-protected, dev-only), so overlap would at worst
   * mix debug output, never corrupt a real trade. */
  startRecording(): void {
    this.debugRecorder = [];
  }

  /** Stops capturing and returns everything recorded since startRecording(). */
  stopRecording(): IgDebugEntry[] {
    const entries = this.debugRecorder ?? [];
    this.debugRecorder = null;
    return entries;
  }

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

    const startedAt = Date.now();
    for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
      try {
        const response = await firstValueFrom(this.httpService.request<T>(config));
        this.recordDebugEntry(config, options.version, startedAt, response.data);
        return response.data;
      } catch (error) {
        const status = (error as AxiosError).response?.status;
        const isRetryable = status !== undefined && RETRYABLE_STATUS_CODES.has(status);
        if (!isRetryable || attempt === MAX_REQUEST_ATTEMPTS) {
          const igError = this.toIgApiException(error);
          this.recordDebugEntry(config, options.version, startedAt, undefined, igError.errorCode);
          throw igError;
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

  // Records the actual wire-level method (e.g. POST + _method: DELETE for a
  // close-position call, not the logical "DELETE") — that distinction is
  // exactly the kind of IG quirk this debug view exists to surface.
  private recordDebugEntry(
    config: AxiosRequestConfig,
    version: number,
    startedAt: number,
    responseBody?: unknown,
    errorCode?: string,
  ): void {
    if (!this.debugRecorder) {
      return;
    }
    this.debugRecorder.push({
      method: config.method as string,
      url: config.url as string,
      version,
      requestBody: config.data ?? null,
      responseBody,
      errorCode,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
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
