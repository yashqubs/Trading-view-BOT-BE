import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Direction, TradeStatus } from '../common/enums';
import { IgApiException } from '../ig-client/ig-api.exception';
import { IgClientService } from '../ig-client/ig-client.service';
import { IgPosition } from '../ig-client/ig-client.types';
import { StockMapping } from '../mapping/entities/stock-mapping.entity';
import { TradingRulesService } from '../trading-rules/trading-rules.service';
import { TradeLogQueryDto } from './dto/trade-log-query.dto';
import { TradeLog } from './entities/trade-log.entity';
import { SignalInput } from './interfaces/signal-input.interface';
import { calculateQuantity } from './utils/calculate-quantity.util';

export interface PaginatedTradeLogs {
  items: TradeLog[];
  total: number;
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
        // Close the full existing exposure rather than a freshly recomputed
        // size — IG identifies the position by dealId/size, and a partial
        // mismatch would leave a dangling position open.
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

      const successLog = await this.tradeLogRepository.save(
        this.tradeLogRepository.create({
          ...baseLog,
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

    const qb = this.buildFilteredQuery(query);
    qb.skip((page - 1) * pageSize).take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  /** Same filters as findAll(), but unpaginated — used for CSV export. */
  findAllForExport(query: TradeLogQueryDto): Promise<TradeLog[]> {
    return this.buildFilteredQuery(query).getMany();
  }

  private buildFilteredQuery(query: TradeLogQueryDto) {
    const qb = this.tradeLogRepository
      .createQueryBuilder('trade')
      .orderBy('trade.createdAt', 'DESC');

    if (query.ticker) qb.andWhere('trade.tvTicker = :ticker', { ticker: query.ticker });
    if (query.status) qb.andWhere('trade.status = :status', { status: query.status });
    if (query.direction)
      qb.andWhere('trade.direction = :direction', { direction: query.direction });
    if (query.from) qb.andWhere('trade.createdAt >= :from', { from: query.from });
    if (query.to) qb.andWhere('trade.createdAt <= :to', { to: query.to });

    return qb;
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
