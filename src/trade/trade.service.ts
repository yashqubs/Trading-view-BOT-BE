import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository, SelectQueryBuilder } from 'typeorm';
import { Direction, ExecutionMode, TradeStatus } from '../common/enums';
import { IgApiException } from '../ig-client/ig-api.exception';
import { IgClientService } from '../ig-client/ig-client.service';
import { ConfirmDealResult, IgPosition } from '../ig-client/ig-client.types';
import { StockMapping } from '../mapping/entities/stock-mapping.entity';
import { resolveInvestmentAmount } from '../mapping/utils/resolve-investment-amount.util';
import { TradingRules } from '../trading-rules/entities/trading-rules.entity';
import { TradingRulesService } from '../trading-rules/trading-rules.service';
import { TradeLogQueryDto } from './dto/trade-log-query.dto';
import { SortOrder, TRADE_LOG_SORT_COLUMN, TradeLogSortBy } from './dto/trade-log-sort.enum';
import { TradeLog } from './entities/trade-log.entity';
import { SignalInput } from './interfaces/signal-input.interface';
import { TradeLogSummary } from './interfaces/trade-log-summary.interface';
import { calculateLimitLevel } from './utils/calculate-limit-level.util';
import { calculateSize } from './utils/calculate-size.util';
import { assertSignalPricePlausible, derivePriceScaleFactor } from './utils/ig-price-scale.util';

export interface PaginatedTradeLogs {
  items: TradeLog[];
  total: number;
  summary: TradeLogSummary;
}

// Confirmed live 2026-07-16: IG's own position propagation can lag behind
// an ambiguous confirmDeal response by up to a second or so. This runs after
// the webhook has already responded (processed async — see WebhookController),
// so it never risks the 3-second webhook deadline; the test-signal endpoint
// is the only caller that waits on it, and a ~1s worst case is acceptable
// for a dev tool.
const RECONCILE_MAX_ATTEMPTS = 3;
const RECONCILE_RETRY_DELAY_MS = 500;

@Injectable()
export class TradeService {
  private readonly logger = new Logger(TradeService.name);

  constructor(
    @InjectRepository(TradeLog) private readonly tradeLogRepository: Repository<TradeLog>,
    private readonly igClientService: IgClientService,
    private readonly tradingRulesService: TradingRulesService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async logSkip(
    input: SignalInput,
    status: TradeStatus,
    igEpic: string | null = null,
  ): Promise<TradeLog> {
    const skipped = await this.tradeLogRepository.save(
      this.tradeLogRepository.create({
        tvTicker: input.tvTicker,
        igEpic,
        direction: input.direction,
        signalPrice: input.signalPrice,
        status,
        skipReason: status,
        signalReceivedAt: input.signalReceivedAt,
      }),
    );
    this.emitTradeCreated(skipped);
    return skipped;
  }

  /**
   * Executes the trade on IG and logs the outcome. Caller (SignalModule) has
   * already run every condition check and resolved `existingPosition` — this
   * method decides open-vs-close from whether it's null, NOT from
   * `input.direction`, since short selling (2026-07-16) means either
   * direction can open a new position or close an existing opposite one:
   *   - `existingPosition` is null       → OPENING. BUY opens a long, SELL
   *     opens a short — the order direction sent to IG matches input.direction.
   *   - `existingPosition` is not null   → CLOSING it. The order direction
   *     sent to IG is the OPPOSITE of the existing position's own direction
   *     (closing a long = a SELL order; closing a short = a BUY order),
   *     regardless of input.direction — the caller already guarantees
   *     input.direction is opposite to existingPosition.direction (see
   *     SignalService's ALREADY_LONG/ALREADY_SHORT skip).
   *
   * `rules` supplies the global default execution mode + slippage tolerance;
   * `mapping.executionMode`/`mapping.maxSlippagePercent` override them
   * independently for this specific stock when set. SIGNAL_PRICE places a
   * LIMIT order at the signal price adjusted by the tolerance (see
   * calculateLimitLevel — 0% tolerance means the exact signal price) — IG
   * either fills it at that level or better, or rejects it, same as a market
   * order would; there is no working-order follow-up, so a rejected LIMIT
   * order just logs FAILED like anything else.
   */
  async executeTrade(
    input: SignalInput,
    mapping: StockMapping,
    existingPosition: IgPosition | null,
    rules: TradingRules,
  ): Promise<TradeLog> {
    const investmentAmount = resolveInvestmentAmount(
      mapping,
      rules,
      input.investmentAmountOverride,
    );
    const executionMode =
      input.executionModeOverride ?? mapping.executionMode ?? rules.executionMode;
    const maxSlippagePercent = Number(
      input.maxSlippagePercentOverride ?? mapping.maxSlippagePercent ?? rules.maxSlippagePercent,
    );

    // size and tradeValue start null — both can fail to resolve (implausible
    // signal price, no live quote, below IG's minimum deal size), and that
    // must still produce a logged FAILED row, not vanish before baseLog
    // exists.
    const baseLog: {
      tvTicker: string;
      igEpic: string;
      direction: Direction;
      signalPrice: number;
      tradeValue: number | null;
      size: number | null;
      maxSlippagePercent: number | null;
      signalReceivedAt: Date;
    } = {
      tvTicker: input.tvTicker,
      igEpic: mapping.igEpic,
      direction: input.direction,
      signalPrice: input.signalPrice,
      tradeValue: null,
      size: null,
      // Only meaningful when a LIMIT level enforces it — null on MARKET
      // trades so the history doesn't imply a protection that wasn't active.
      maxSlippagePercent: executionMode === ExecutionMode.SIGNAL_PRICE ? maxSlippagePercent : null,
      signalReceivedAt: input.signalReceivedAt,
    };

    try {
      const isClosing = existingPosition !== null;
      // The direction actually sent to IG — opposite of the existing
      // position when closing (closing a long is a SELL order, closing a
      // short is a BUY order), or input.direction when opening fresh.
      const orderDirection = isClosing
        ? existingPosition!.direction === Direction.BUY
          ? Direction.SELL
          : Direction.BUY
        : input.direction;

      // Every trade (MARKET included) is anchored to IG's live quote before
      // any order goes out: the signal price must resemble the real market
      // (assertSignalPricePlausible — sizing, trade value, and the slippage
      // ceiling are all computed from it, so an implausible price corrupts
      // everything downstream), and the derived power-of-ten factor converts
      // between the signal scale and IG's points scale. The reference side
      // (offer/bid) follows the order we're actually about to send, not the
      // raw signal direction — a BUY order (whether opening a long or
      // closing a short) buys at the offer; a SELL order sells at the bid.
      const details = await this.igClientService.getMarketDetails(mapping.igEpic);
      const reference =
        orderDirection === Direction.BUY ? details.snapshot?.offer : details.snapshot?.bid;
      if (reference == null || reference <= 0) {
        throw new IgApiException('NO_LIVE_QUOTE');
      }
      const priceScaleFactor = derivePriceScaleFactor(reference, input.signalPrice);
      assertSignalPricePlausible(reference, input.signalPrice, priceScaleFactor);
      const pricePoints = input.signalPrice * priceScaleFactor;

      let size: number;
      if (isClosing) {
        // Closing a position (long or short) is never a new investment —
        // tradeValue stays null (see the entity comment); size is whatever
        // the existing position is.
        size = existingPosition!.size;
      } else {
        size = calculateSize(investmentAmount, pricePoints);
        const minDealSize = details.dealingRules?.minDealSize?.value;
        if (minDealSize != null && size < minDealSize) {
          const minInvestment = minDealSize * pricePoints;
          throw new BadRequestException(
            `Investment amount is too small — IG's minimum for ${mapping.tvTicker} at the current price is approximately £${minInvestment.toFixed(2)}`,
          );
        }
        baseLog.tradeValue = Number((size * pricePoints).toFixed(2));
      }
      baseLog.size = size;

      const igOrderParams =
        executionMode === ExecutionMode.SIGNAL_PRICE
          ? {
              orderType: 'LIMIT' as const,
              level: this.roundToMarketPrecision(
                calculateLimitLevel(pricePoints, orderDirection, maxSlippagePercent),
                details.snapshot.decimalPlacesFactor,
              ),
            }
          : { orderType: 'MARKET' as const };

      let dealReference: string;

      if (isClosing) {
        const result = await this.igClientService.closePosition({
          dealId: existingPosition!.dealId,
          direction: orderDirection,
          size,
          ...igOrderParams,
        });
        dealReference = result.dealReference;
      } else {
        const result = await this.igClientService.placeOrder({
          epic: mapping.igEpic,
          direction: orderDirection,
          size,
          ...igOrderParams,
        });
        dealReference = result.dealReference;
      }

      let confirmation: ConfirmDealResult | null = null;
      let confirmError: unknown = null;
      try {
        confirmation = await this.igClientService.confirmDeal(dealReference);
      } catch (error) {
        confirmError = error;
      }

      if (!confirmation || confirmation.dealStatus !== 'ACCEPTED') {
        // confirmDeal is sometimes ambiguous — it can throw (e.g. IG's
        // `error.confirms.deal-not-found`) or come back non-ACCEPTED even
        // when the order actually went through on IG's side. Confirmed live
        // 2026-07-16 across four separate trades (GOOG, COIN, and Gold
        // twice) where this app logged FAILED while IG's own history showed
        // a real filled position. Never trust an ambiguous/negative confirm
        // alone — check IG's actual open positions first.
        const reconciled = await this.reconcileAgainstOpenPositions(
          mapping,
          existingPosition,
          orderDirection,
          size,
        );
        if (reconciled) {
          this.logger.warn(
            `Reconciled ${input.direction} ${input.tvTicker} as SUCCESS via open-positions lookup — ` +
              `confirmDeal was ambiguous (${confirmError ? this.resolveErrorCode(confirmError) : confirmation?.reason}).`,
          );
          return this.saveSuccess(
            baseLog,
            dealReference,
            reconciled.dealId,
            reconciled.level,
            priceScaleFactor,
          );
        }
        const errorMessage = confirmError
          ? this.resolveErrorCode(confirmError)
          : (confirmation?.reason ?? 'REJECTED');
        return this.saveFailedAndHandle(baseLog, dealReference, errorMessage);
      }

      return this.saveSuccess(
        baseLog,
        dealReference,
        confirmation.dealId,
        confirmation.level,
        priceScaleFactor,
      );
    } catch (error) {
      return this.saveFailedAndHandle(baseLog, null, this.resolveErrorCode(error));
    }
  }

  private async saveSuccess(
    baseLog: Partial<TradeLog>,
    dealReference: string,
    dealId: string,
    level: number | null,
    priceScaleFactor: number,
  ): Promise<TradeLog> {
    const successLog = await this.tradeLogRepository.save(
      this.tradeLogRepository.create({
        ...baseLog,
        status: TradeStatus.SUCCESS,
        dealReference,
        dealId,
        // IG confirms in its own points scale; convert back with the factor
        // derived from the live quote (not from the fill-vs-signal ratio,
        // which a bad signal price would distort) so executed_price is
        // comparable to signal_price everywhere.
        executedPrice: level != null ? level / priceScaleFactor : null,
        executedAt: new Date(),
      }),
    );
    this.emitTradeCreated(successLog);
    await this.emitPositionsUpdated();
    await this.tradingRulesService.resetFailureCount();
    return successLog;
  }

  /**
   * Called only when confirmDeal was ambiguous — checks IG's real open
   * positions before trusting that ambiguity as a genuine failure. Never
   * throws: a failure here just means "couldn't reconcile," falling through
   * to the normal FAILED path, since this is a best-effort safety net on top
   * of confirmDeal, not a required step.
   *
   * Retries a few times with a short delay: confirmDeal's own "deal not
   * found" ambiguity is IG-side propagation lag (the position isn't fully
   * registered internally yet), and GET /positions can suffer the exact same
   * lag — checking only once, immediately, risks a false "not found" that a
   * few hundred milliseconds would have resolved (confirmed live 2026-07-16:
   * OSCR filled on IG but an immediate reconciliation attempt still missed
   * it before this retry was added).
   */
  private async reconcileAgainstOpenPositions(
    mapping: StockMapping,
    existingPosition: IgPosition | null,
    orderDirection: Direction,
    size: number,
  ): Promise<{ dealId: string; level: number | null } | null> {
    const isClosing = existingPosition !== null;
    for (let attempt = 1; attempt <= RECONCILE_MAX_ATTEMPTS; attempt++) {
      try {
        const positions = await this.igClientService.getOpenPositions();

        if (isClosing) {
          // Reconciled success = the position we tried to close is now gone.
          if (!positions.some((p) => p.dealId === existingPosition!.dealId)) {
            return { dealId: existingPosition!.dealId, level: null };
          }
        } else {
          // Opening (long or short): look for a newly opened position
          // matching epic/direction/size — exact size match, since it's the
          // precise value just sent.
          const match = positions.find(
            (p) =>
              p.epic === mapping.igEpic &&
              p.direction === orderDirection &&
              Math.abs(p.size - size) < 0.0001,
          );
          if (match) {
            return { dealId: match.dealId, level: match.level };
          }
        }
      } catch {
        // A failed lookup attempt is retried the same as a genuine "no
        // match yet" — either way, waiting and trying again is safe.
      }

      if (attempt < RECONCILE_MAX_ATTEMPTS) {
        await this.delay(RECONCILE_RETRY_DELAY_MS);
      }
    }
    return null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // IG rejects levels more precise than the market's own quote precision
  // (decimalPlacesFactor — GOOG quotes 1dp, calculateLimitLevel rounds 2dp).
  private roundToMarketPrecision(level: number, decimalPlaces: number | null): number {
    return decimalPlaces != null && decimalPlaces >= 0
      ? Number(level.toFixed(decimalPlaces))
      : level;
  }

  private resolveErrorCode(error: unknown): string {
    if (error instanceof IgApiException) {
      return error.errorCode;
    }
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      const message =
        typeof response === 'string' ? response : (response as { message?: string }).message;
      return message ?? 'VALIDATION_ERROR';
    }
    return 'UNKNOWN_ERROR';
  }

  async findAll(query: TradeLogQueryDto): Promise<PaginatedTradeLogs> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    const summaryQb = this.buildFilteredQuery(query);
    const [summary, total] = await Promise.all([
      this.computeSummary(summaryQb),
      summaryQb.getCount(),
    ]);

    const itemsQb = this.buildFilteredQuery(query);
    this.applySort(itemsQb, query);
    itemsQb.skip((page - 1) * pageSize).take(pageSize);

    const items = await itemsQb.getMany();
    return { items, total, summary };
  }

  /** Same filters as findAll(), but unpaginated — used for CSV export. */
  findAllForExport(query: TradeLogQueryDto): Promise<TradeLog[]> {
    const qb = this.buildFilteredQuery(query);
    this.applySort(qb, query);
    return qb.getMany();
  }

  private buildFilteredQuery(query: TradeLogQueryDto): SelectQueryBuilder<TradeLog> {
    const qb = this.tradeLogRepository.createQueryBuilder('trade');

    if (query.ticker) qb.andWhere('trade.tvTicker = :ticker', { ticker: query.ticker });
    if (query.status) qb.andWhere('trade.status = :status', { status: query.status });
    if (query.direction)
      qb.andWhere('trade.direction = :direction', { direction: query.direction });
    if (query.from) qb.andWhere('trade.createdAt >= :from', { from: query.from });
    if (query.to) qb.andWhere('trade.createdAt <= :to', { to: query.to });

    return qb;
  }

  private applySort(qb: SelectQueryBuilder<TradeLog>, query: TradeLogQueryDto): void {
    const sortBy = query.sortBy ?? TradeLogSortBy.SIGNAL_RECEIVED_AT;
    const sortOrder = (query.sortOrder ?? SortOrder.DESC).toUpperCase() as 'ASC' | 'DESC';
    qb.orderBy(TRADE_LOG_SORT_COLUMN[sortBy], sortOrder);
  }

  private async computeSummary(qb: SelectQueryBuilder<TradeLog>): Promise<TradeLogSummary> {
    const raw = await qb
      .select('COUNT(*)', 'totalTrades')
      .addSelect(`SUM(CASE WHEN trade.status = :successStatus THEN 1 ELSE 0 END)`, 'successCount')
      .addSelect(`SUM(CASE WHEN trade.status = :failedStatus THEN 1 ELSE 0 END)`, 'failedCount')
      .addSelect(
        `SUM(CASE WHEN trade.status NOT IN (:successStatus, :failedStatus) THEN 1 ELSE 0 END)`,
        'skippedCount',
      )
      .addSelect(`SUM(CASE WHEN trade.direction = :buyDirection THEN 1 ELSE 0 END)`, 'buyCount')
      .addSelect(`SUM(CASE WHEN trade.direction = :sellDirection THEN 1 ELSE 0 END)`, 'sellCount')
      .addSelect(
        `COALESCE(SUM(CASE WHEN trade.status = :successStatus AND trade.tradeValue IS NOT NULL THEN trade.tradeValue ELSE 0 END), 0)`,
        'totalInvested',
      )
      .addSelect(
        `AVG(CASE WHEN trade.status = :successStatus AND trade.tradeValue IS NOT NULL THEN trade.tradeValue END)`,
        'avgInvestment',
      )
      .setParameters({
        successStatus: TradeStatus.SUCCESS,
        failedStatus: TradeStatus.FAILED,
        buyDirection: Direction.BUY,
        sellDirection: Direction.SELL,
      })
      .getRawOne<{
        totalTrades: string;
        successCount: string;
        failedCount: string;
        skippedCount: string;
        buyCount: string;
        sellCount: string;
        totalInvested: string;
        avgInvestment: string;
      }>();

    const totalTrades = Number(raw?.totalTrades ?? 0);
    const successCount = Number(raw?.successCount ?? 0);
    const avgInvestmentValue = raw?.avgInvestment;

    return {
      totalTrades,
      successCount,
      failedCount: Number(raw?.failedCount ?? 0),
      skippedCount: Number(raw?.skippedCount ?? 0),
      buyCount: Number(raw?.buyCount ?? 0),
      sellCount: Number(raw?.sellCount ?? 0),
      totalInvested: Number(raw?.totalInvested ?? 0),
      successRate: totalTrades > 0 ? (successCount / totalTrades) * 100 : 0,
      avgInvestment:
        avgInvestmentValue !== null && avgInvestmentValue !== undefined
          ? Number(avgInvestmentValue)
          : null,
    };
  }

  async countSuccessToday(): Promise<number> {
    return this.tradeLogRepository.count({
      where: { status: TradeStatus.SUCCESS, createdAt: Between(...this.todayRange()) },
    });
  }

  async sumInvestmentSuccessToday(tvTicker?: string): Promise<number> {
    const qb = this.tradeLogRepository
      .createQueryBuilder('trade')
      .select('COALESCE(SUM(trade.tradeValue), 0)', 'total')
      .where('trade.status = :status', { status: TradeStatus.SUCCESS })
      .andWhere('trade.createdAt BETWEEN :from AND :to', {
        from: this.todayRange()[0],
        to: this.todayRange()[1],
      });

    if (tvTicker) {
      qb.andWhere('trade.tvTicker = :tvTicker', { tvTicker });
    }

    const result = await qb.getRawOne<{ total: string }>();
    return Number(result?.total ?? 0);
  }

  // Every webhook delivery writes a trade_log row via logSkip() or
  // executeTrade() — including duplicates and every skip reason — so the
  // most recent signalReceivedAt here is exactly "when did TradingView last
  // actually hit our webhook", independent of whether that signal traded.
  async getLastSignalReceivedAt(): Promise<Date | null> {
    const latest = await this.tradeLogRepository.findOne({
      where: {},
      order: { signalReceivedAt: 'DESC' },
      select: ['signalReceivedAt'],
    });
    return latest?.signalReceivedAt ?? null;
  }

  private async saveFailedAndHandle(
    baseLog: Partial<TradeLog>,
    dealReference: string | null,
    errorMessage: string,
  ): Promise<TradeLog> {
    const failedLog = await this.tradeLogRepository.save(
      this.tradeLogRepository.create({
        ...baseLog,
        status: TradeStatus.FAILED,
        dealReference,
        errorMessage,
      }),
    );
    this.emitTradeCreated(failedLog);

    const shouldAutoPause = await this.tradingRulesService.recordFailure();
    if (shouldAutoPause) {
      const autoPausedLog = await this.tradeLogRepository.save(
        this.tradeLogRepository.create({ ...baseLog, status: TradeStatus.AUTO_PAUSED }),
      );
      this.emitTradeCreated(autoPausedLog);
    }

    return failedLog;
  }

  // A broadcast is a side effect of something already durably saved — it must
  // never throw back into trade execution, which is why both of these swallow
  // and log rather than propagate.
  private emitTradeCreated(trade: TradeLog): void {
    try {
      this.eventEmitter.emit('trade.created', trade);
    } catch (error) {
      this.logger.warn(`Failed to emit trade.created: ${(error as Error).message}`);
    }
  }

  private async emitPositionsUpdated(): Promise<void> {
    try {
      const positions = await this.igClientService.getOpenPositions();
      this.eventEmitter.emit('positions.updated', positions);
    } catch (error) {
      this.logger.warn(`Failed to emit positions.updated: ${(error as Error).message}`);
    }
  }

  private todayRange(): [Date, Date] {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
    return [start, end];
  }
}
