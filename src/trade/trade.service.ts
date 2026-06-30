import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository, SelectQueryBuilder } from 'typeorm';
import { Direction, TradeStatus } from '../common/enums';
import { IgApiException } from '../ig-client/ig-api.exception';
import { IgClientService } from '../ig-client/ig-client.service';
import { IgPosition } from '../ig-client/ig-client.types';
import { StockMapping } from '../mapping/entities/stock-mapping.entity';
import { TradingRulesService } from '../trading-rules/trading-rules.service';
import { TradeLogQueryDto } from './dto/trade-log-query.dto';
import { SortOrder, TRADE_LOG_SORT_COLUMN, TradeLogSortBy } from './dto/trade-log-sort.enum';
import { TradeLog } from './entities/trade-log.entity';
import { SignalInput } from './interfaces/signal-input.interface';
import { TradeLogSummary } from './interfaces/trade-log-summary.interface';
import { calculateProfitLoss } from './utils/calculate-profit-loss.util';
import { calculateQuantity } from './utils/calculate-quantity.util';

export interface PaginatedTradeLogs {
  items: TradeLog[];
  total: number;
  summary: TradeLogSummary;
}

@Injectable()
export class TradeService {
  constructor(
    @InjectRepository(TradeLog) private readonly tradeLogRepository: Repository<TradeLog>,
    private readonly igClientService: IgClientService,
    private readonly tradingRulesService: TradingRulesService,
  ) {}

  async logSkip(
    input: SignalInput,
    status: TradeStatus,
    igEpic: string | null = null,
  ): Promise<TradeLog> {
    return this.tradeLogRepository.save(
      this.tradeLogRepository.create({
        tvTicker: input.tvTicker,
        igEpic,
        direction: input.direction,
        signalPrice: input.signalPrice.toFixed(4),
        status,
        skipReason: status,
        signalReceivedAt: input.signalReceivedAt,
      }),
    );
  }

  /**
   * Executes the trade on IG and logs the outcome. Caller (SignalModule) has
   * already run every condition check — for SELL, `existingPosition` is the
   * open position to close (matched during the SELL position check).
   */
  async executeTrade(
    input: SignalInput,
    mapping: StockMapping,
    existingPosition: IgPosition | null,
  ): Promise<TradeLog> {
    const quantity = calculateQuantity(Number(mapping.investmentAmount), input.signalPrice);

    const baseLog = {
      tvTicker: input.tvTicker,
      igEpic: mapping.igEpic,
      direction: input.direction,
      signalPrice: input.signalPrice.toFixed(4),
      investmentAmount: mapping.investmentAmount,
      quantity: quantity.toFixed(4),
      signalReceivedAt: input.signalReceivedAt,
    };

    try {
      let dealReference: string;

      if (input.direction === Direction.SELL) {
        if (!existingPosition) {
          throw new IgApiException('NO_POSITION_AT_EXECUTION');
        }
        const result = await this.igClientService.closePosition({
          dealId: existingPosition.dealId,
          direction: Direction.SELL,
          size: existingPosition.size,
        });
        dealReference = result.dealReference;
      } else {
        const result = await this.igClientService.placeOrder({
          epic: mapping.igEpic,
          direction: Direction.BUY,
          size: quantity,
        });
        dealReference = result.dealReference;
      }

      const confirmation = await this.igClientService.confirmDeal(dealReference);

      if (confirmation.dealStatus !== 'ACCEPTED') {
        return this.saveFailedAndHandle(baseLog, dealReference, confirmation.reason ?? 'REJECTED');
      }

      const closeMetrics =
        input.direction === Direction.SELL && existingPosition
          ? await this.buildCloseMetrics(input, existingPosition)
          : null;

      const successLog = await this.tradeLogRepository.save(
        this.tradeLogRepository.create({
          ...baseLog,
          ...(closeMetrics ?? {}),
          quantity:
            input.direction === Direction.SELL
              ? existingPosition!.size.toFixed(4)
              : baseLog.quantity,
          status: TradeStatus.SUCCESS,
          dealReference,
          dealId: confirmation.dealId,
          executedAt: new Date(),
        }),
      );

      await this.tradingRulesService.resetFailureCount();
      return successLog;
    } catch (error) {
      const errorCode = error instanceof IgApiException ? error.errorCode : 'UNKNOWN_ERROR';
      return this.saveFailedAndHandle(baseLog, null, errorCode);
    }
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
        `COALESCE(SUM(CASE WHEN trade.status = :successStatus AND trade.investmentAmount IS NOT NULL THEN trade.investmentAmount ELSE 0 END), 0)`,
        'totalInvested',
      )
      .addSelect(`SUM(trade.profitLoss)`, 'totalProfitLoss')
      .addSelect(`COUNT(trade.profitLoss)`, 'closedCount')
      .addSelect(
        `AVG(CASE WHEN trade.status = :successStatus AND trade.investmentAmount IS NOT NULL THEN trade.investmentAmount END)`,
        'avgInvestment',
      )
      .addSelect(`SUM(CASE WHEN trade.profitLoss > 0 THEN 1 ELSE 0 END)`, 'winCount')
      .addSelect(`SUM(CASE WHEN trade.profitLoss < 0 THEN 1 ELSE 0 END)`, 'lossCount')
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
        totalProfitLoss: string | null;
        closedCount: string;
        avgInvestment: string;
        winCount: string;
        lossCount: string;
      }>();

    const totalTrades = Number(raw?.totalTrades ?? 0);
    const successCount = Number(raw?.successCount ?? 0);
    const closedCount = Number(raw?.closedCount ?? 0);
    const totalProfitLossRaw = raw?.totalProfitLoss;

    const totalProfitLoss =
      closedCount > 0 && totalProfitLossRaw !== null ? Number(totalProfitLossRaw) : null;

    const avgInvestmentValue = raw?.avgInvestment;

    return {
      totalTrades,
      successCount,
      failedCount: Number(raw?.failedCount ?? 0),
      skippedCount: Number(raw?.skippedCount ?? 0),
      buyCount: Number(raw?.buyCount ?? 0),
      sellCount: Number(raw?.sellCount ?? 0),
      totalInvested: Number(raw?.totalInvested ?? 0),
      totalProfitLoss,
      avgProfitLoss:
        closedCount > 0 && totalProfitLoss !== null ? totalProfitLoss / closedCount : null,
      successRate: totalTrades > 0 ? (successCount / totalTrades) * 100 : 0,
      avgInvestment:
        avgInvestmentValue !== null && avgInvestmentValue !== undefined
          ? Number(avgInvestmentValue)
          : null,
      winCount: Number(raw?.winCount ?? 0),
      lossCount: Number(raw?.lossCount ?? 0),
    };
  }

  private async buildCloseMetrics(
    input: SignalInput,
    existingPosition: IgPosition,
  ): Promise<Pick<TradeLog, 'closingPrice' | 'profitLoss' | 'profitLossPct'>> {
    const openingBuy = await this.findOpeningBuyTrade(input.tvTicker);
    if (!openingBuy) {
      return {
        closingPrice: input.signalPrice.toFixed(4),
        profitLoss: null,
        profitLossPct: null,
      };
    }

    const entryPrice = Number(openingBuy.signalPrice);
    const investmentAmount = Number(openingBuy.investmentAmount ?? 0);
    const { profitLoss, profitLossPct } = calculateProfitLoss({
      entryPrice,
      closingPrice: input.signalPrice,
      quantity: existingPosition.size,
      investmentAmount,
    });

    return {
      closingPrice: input.signalPrice.toFixed(4),
      profitLoss: profitLoss.toFixed(2),
      profitLossPct: profitLossPct.toFixed(4),
    };
  }

  private findOpeningBuyTrade(tvTicker: string): Promise<TradeLog | null> {
    return this.tradeLogRepository.findOne({
      where: { tvTicker, direction: Direction.BUY, status: TradeStatus.SUCCESS },
      order: { executedAt: 'DESC' },
    });
  }

  async countSuccessToday(): Promise<number> {
    return this.tradeLogRepository.count({
      where: { status: TradeStatus.SUCCESS, createdAt: Between(...this.todayRange()) },
    });
  }

  async sumInvestmentSuccessToday(tvTicker?: string): Promise<number> {
    const qb = this.tradeLogRepository
      .createQueryBuilder('trade')
      .select('COALESCE(SUM(trade.investmentAmount), 0)', 'total')
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

  async getLastSuccessfulTrade(tvTicker: string): Promise<TradeLog | null> {
    return this.tradeLogRepository.findOne({
      where: { tvTicker, status: TradeStatus.SUCCESS },
      order: { createdAt: 'DESC' },
    });
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

    const shouldAutoPause = await this.tradingRulesService.recordFailure();
    if (shouldAutoPause) {
      await this.tradeLogRepository.save(
        this.tradeLogRepository.create({ ...baseLog, status: TradeStatus.AUTO_PAUSED }),
      );
    }

    return failedLog;
  }

  private todayRange(): [Date, Date] {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
    return [start, end];
  }
}
