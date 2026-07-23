import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Direction, TradeStatus } from '../common/enums';
import { IgClientService } from '../ig-client/ig-client.service';
import { MappingService } from '../mapping/mapping.service';
import { TradeLog } from '../trade/entities/trade-log.entity';
import { TradingRulesService } from '../trading-rules/trading-rules.service';
import { DailyActivityQueryDto } from './dto/daily-activity-query.dto';
import { StatsDaysQueryDto } from './dto/stats-days-query.dto';
import { StatsFilterQueryDto } from './dto/stats-filter-query.dto';
import {
  DailyActivityPoint,
  OpenPosition,
  OverviewStats,
  StatusBreakdownPoint,
  StockActivity,
  StockStats,
} from './interfaces/stats.interfaces';
import { applyStatsFilters, StatsFilterOptions, toStatsFilter } from './utils/stats-query.util';

const EXECUTED_STATUSES = [TradeStatus.SUCCESS, TradeStatus.FAILED];

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(TradeLog) private readonly tradeLogRepository: Repository<TradeLog>,
    private readonly tradingRulesService: TradingRulesService,
    private readonly igClientService: IgClientService,
    private readonly mappingService: MappingService,
  ) {}

  async overview(query: StatsFilterQueryDto = {}): Promise<OverviewStats> {
    const filter = toStatsFilter(query);
    const rules = await this.tradingRulesService.get();
    const [start, end] = this.todayRange();

    const executedBase = applyStatsFilters(
      this.tradeLogRepository
        .createQueryBuilder('trade')
        .where('trade.status IN (:...statuses)', { statuses: EXECUTED_STATUSES }),
      filter,
    );

    const successBase = applyStatsFilters(
      this.tradeLogRepository
        .createQueryBuilder('trade')
        .where('trade.status = :status', { status: TradeStatus.SUCCESS }),
      filter,
    );

    const todaysBase = this.tradeLogRepository
      .createQueryBuilder('trade')
      .where('trade.status IN (:...statuses)', { statuses: EXECUTED_STATUSES })
      .andWhere('trade.createdAt BETWEEN :start AND :end', { start, end });
    if (filter.ticker) {
      todaysBase.andWhere('trade.tvTicker = :ticker', { ticker: filter.ticker });
    }

    const todaysInvestedBase = this.tradeLogRepository
      .createQueryBuilder('trade')
      .select('COALESCE(SUM(trade.tradeValue), 0)', 'total')
      .where('trade.status = :status', { status: TradeStatus.SUCCESS })
      .andWhere('trade.isClosingTrade = false')
      .andWhere('trade.createdAt BETWEEN :start AND :end', { start, end });
    if (filter.ticker) {
      todaysInvestedBase.andWhere('trade.tvTicker = :ticker', { ticker: filter.ticker });
    }

    const directionQb = applyStatsFilters(
      this.tradeLogRepository
        .createQueryBuilder('trade')
        .select('SUM(CASE WHEN trade.direction = :buy THEN 1 ELSE 0 END)', 'buyCount')
        .addSelect('SUM(CASE WHEN trade.direction = :sell THEN 1 ELSE 0 END)', 'sellCount')
        .where('trade.status IN (:...statuses)', { statuses: EXECUTED_STATUSES })
        .setParameters({ buy: Direction.BUY, sell: Direction.SELL }),
      filter,
    );

    const [
      totalTrades,
      todaysTrades,
      successCount,
      todaysInvestedRaw,
      directionCounts,
      openPositions,
    ] = await Promise.all([
      executedBase.getCount(),
      todaysBase.getCount(),
      successBase.getCount(),
      todaysInvestedBase.getRawOne<{ total: string }>(),
      directionQb.getRawOne<{ buyCount: string; sellCount: string }>(),
      this.resolveOpenPositions(filter.ticker),
    ]);

    const todaysInvested = Number(todaysInvestedRaw?.total ?? 0);
    const successRate = totalTrades > 0 ? (successCount / totalTrades) * 100 : 0;

    return {
      botEnabled: rules.botEnabled,
      autoPaused: rules.autoPaused,
      totalTrades,
      todaysTrades,
      todaysInvested,
      dailyMaxTotalInvestment:
        rules.dailyMaxTotalInvestment !== null ? Number(rules.dailyMaxTotalInvestment) : null,
      dailyMaxTradeCount: rules.dailyMaxTradeCount,
      openPositions,
      successRate,
      consecutiveFailures: rules.consecutiveFailureCount,
      buyCount: Number(directionCounts?.buyCount ?? 0),
      sellCount: Number(directionCounts?.sellCount ?? 0),
    };
  }

  async dailyActivity(query: DailyActivityQueryDto = {}): Promise<DailyActivityPoint[]> {
    const hasDateRange = Boolean(query.from && query.to);
    const days = hasDateRange ? undefined : (query.days ?? 30);
    const filter = toStatsFilter({ days, ticker: query.ticker, from: query.from, to: query.to });

    const rows = await applyStatsFilters(
      this.tradeLogRepository
        .createQueryBuilder('trade')
        .select("TO_CHAR(trade.createdAt, 'YYYY-MM-DD')", 'date')
        .addSelect('COUNT(*)', 'trades')
        .addSelect(
          'COALESCE(SUM(CASE WHEN trade.status = :success AND trade.isClosingTrade = false THEN trade.tradeValue ELSE 0 END), 0)',
          'invested',
        )
        .where('trade.status IN (:...statuses)', { statuses: EXECUTED_STATUSES })
        .setParameters({ success: TradeStatus.SUCCESS }),
      filter,
    )
      .groupBy('date')
      .orderBy('date', 'ASC')
      .getRawMany<{ date: string; trades: string; invested: string }>();

    return rows.map((row) => ({
      date: row.date,
      trades: Number(row.trades),
      invested: Number(row.invested),
    }));
  }

  async openPositions(ticker?: string): Promise<OpenPosition[]> {
    const [positions, mappings] = await Promise.all([
      this.igClientService.getOpenPositions(),
      this.mappingService.findAll(),
    ]);

    const byEpic = new Map(mappings.map((mapping) => [mapping.igEpic, mapping]));

    return positions
      .map((position) => {
        const mapping = byEpic.get(position.epic);
        return {
          tvTicker: mapping?.tvTicker ?? position.epic,
          instrumentName: mapping?.instrumentName ?? position.epic,
          igEpic: position.epic,
          direction: position.direction,
          size: position.size,
          mapped: !!mapping,
        };
      })
      .filter((position) => !ticker || position.tvTicker === ticker);
  }

  async byStock(query: StatsDaysQueryDto = {}): Promise<StockActivity[]> {
    const filter = toStatsFilter(query);

    const rows = await applyStatsFilters(
      this.tradeLogRepository
        .createQueryBuilder('trade')
        .select('trade.tvTicker', 'tvTicker')
        .addSelect('COUNT(*)', 'trades')
        .addSelect(
          'COALESCE(SUM(CASE WHEN trade.status = :success AND trade.isClosingTrade = false THEN trade.tradeValue ELSE 0 END), 0)',
          'invested',
        )
        .where('trade.status IN (:...statuses)', { statuses: EXECUTED_STATUSES })
        .setParameters({ success: TradeStatus.SUCCESS }),
      filter,
    )
      .groupBy('trade.tvTicker')
      .orderBy('"trades"', 'DESC')
      .getRawMany<{ tvTicker: string; trades: string; invested: string }>();

    return rows.map((row) => ({
      tvTicker: row.tvTicker,
      trades: Number(row.trades),
      invested: Number(row.invested),
    }));
  }

  async statusBreakdown(query: StatsFilterQueryDto = {}): Promise<StatusBreakdownPoint[]> {
    const filter = toStatsFilter(query);

    const rows = await applyStatsFilters(
      this.tradeLogRepository
        .createQueryBuilder('trade')
        .select('trade.status', 'status')
        .addSelect('COUNT(*)', 'count'),
      filter,
    )
      .groupBy('trade.status')
      .getRawMany<{ status: TradeStatus; count: string }>();

    return rows.map((row) => ({ status: row.status, count: Number(row.count) }));
  }

  async stockDetail(tvTicker: string, query: StatsDaysQueryDto = {}): Promise<StockStats> {
    const filter = toStatsFilter(query);

    const totalsRow = await applyStatsFilters(
      this.tradeLogRepository
        .createQueryBuilder('trade')
        .select('COUNT(*)', 'totalTrades')
        .addSelect(
          'COALESCE(SUM(CASE WHEN trade.status = :success AND trade.isClosingTrade = false THEN trade.tradeValue ELSE 0 END), 0)',
          'totalInvested',
        )
        .addSelect('SUM(CASE WHEN trade.direction = :buy THEN 1 ELSE 0 END)', 'buyCount')
        .addSelect('SUM(CASE WHEN trade.direction = :sell THEN 1 ELSE 0 END)', 'sellCount')
        .addSelect('SUM(CASE WHEN trade.status = :success THEN 1 ELSE 0 END)', 'successCount')
        .where('trade.tvTicker = :tvTicker', { tvTicker })
        .andWhere('trade.status IN (:...statuses)', { statuses: EXECUTED_STATUSES })
        .setParameters({ success: TradeStatus.SUCCESS, buy: Direction.BUY, sell: Direction.SELL }),
      filter,
    ).getRawOne<{
      totalTrades: string;
      totalInvested: string;
      buyCount: string;
      sellCount: string;
      successCount: string;
    }>();

    const totalTrades = Number(totalsRow?.totalTrades ?? 0);
    if (totalTrades === 0) {
      throw new NotFoundException('No trade history for this ticker');
    }

    const [lastTrade, statusBreakdown, timeline, entryPrices, investedOverTime, mapping] =
      await Promise.all([
        this.tradeLogRepository.findOne({
          where: { tvTicker, status: TradeStatus.SUCCESS },
          order: { createdAt: 'DESC' },
        }),
        this.statusBreakdownFiltered(tvTicker, filter),
        this.timelineFiltered(tvTicker, filter),
        this.entryPricesFiltered(tvTicker, filter),
        this.investedOverTimeFiltered(tvTicker, filter),
        this.mappingService.findByTicker(tvTicker),
      ]);

    const currentlyOpen = mapping
      ? (await this.igClientService.getOpenPositionCount(mapping.igEpic)) > 0
      : false;

    return {
      tvTicker,
      totalTrades,
      totalInvested: Number(totalsRow?.totalInvested ?? 0),
      buyCount: Number(totalsRow?.buyCount ?? 0),
      sellCount: Number(totalsRow?.sellCount ?? 0),
      successRate: (Number(totalsRow?.successCount ?? 0) / totalTrades) * 100,
      lastTradedAt: lastTrade?.createdAt ?? null,
      currentlyOpen,
      timeline,
      entryPrices,
      statusBreakdown,
      investedOverTime,
    };
  }

  private async resolveOpenPositions(ticker?: string): Promise<number> {
    if (!ticker) {
      return this.igClientService.getOpenPositionCount();
    }

    const mapping = await this.mappingService.findByTicker(ticker);
    if (!mapping) {
      return 0;
    }

    return this.igClientService.getOpenPositionCount(mapping.igEpic);
  }

  private async statusBreakdownFiltered(
    tvTicker: string,
    filter: StatsFilterOptions,
  ): Promise<StatusBreakdownPoint[]> {
    const rows = await applyStatsFilters(
      this.tradeLogRepository
        .createQueryBuilder('trade')
        .select('trade.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('trade.tvTicker = :tvTicker', { tvTicker }),
      filter,
    )
      .groupBy('trade.status')
      .getRawMany<{ status: TradeStatus; count: string }>();

    return rows.map((row) => ({ status: row.status, count: Number(row.count) }));
  }

  private async timelineFiltered(
    tvTicker: string,
    filter: StatsFilterOptions,
  ): Promise<{ date: string; trades: number }[]> {
    const rows = await applyStatsFilters(
      this.tradeLogRepository
        .createQueryBuilder('trade')
        .select("TO_CHAR(trade.createdAt, 'YYYY-MM-DD')", 'date')
        .addSelect('COUNT(*)', 'trades')
        .where('trade.tvTicker = :tvTicker', { tvTicker })
        .andWhere('trade.status IN (:...statuses)', { statuses: EXECUTED_STATUSES }),
      filter,
    )
      .groupBy('date')
      .orderBy('date', 'ASC')
      .getRawMany<{ date: string; trades: string }>();

    return rows.map((row) => ({ date: row.date, trades: Number(row.trades) }));
  }

  private async entryPricesFiltered(
    tvTicker: string,
    filter: StatsFilterOptions,
  ): Promise<{ date: string; price: number }[]> {
    const trades = await applyStatsFilters(
      this.tradeLogRepository
        .createQueryBuilder('trade')
        .where('trade.tvTicker = :tvTicker', { tvTicker })
        .andWhere('trade.status IN (:...statuses)', { statuses: EXECUTED_STATUSES }),
      filter,
    )
      .orderBy('trade.createdAt', 'ASC')
      .getMany();

    return trades.map((trade) => ({
      date: trade.createdAt.toISOString(),
      price: Number(trade.signalPrice),
    }));
  }

  private async investedOverTimeFiltered(
    tvTicker: string,
    filter: StatsFilterOptions,
  ): Promise<{ date: string; invested: number }[]> {
    const rows = await applyStatsFilters(
      this.tradeLogRepository
        .createQueryBuilder('trade')
        .select("TO_CHAR(trade.createdAt, 'YYYY-MM-DD')", 'date')
        .addSelect('COALESCE(SUM(trade.tradeValue), 0)', 'invested')
        .where('trade.tvTicker = :tvTicker', { tvTicker })
        .andWhere('trade.status = :status', { status: TradeStatus.SUCCESS })
        .andWhere('trade.isClosingTrade = false'),
      filter,
    )
      .groupBy('date')
      .orderBy('date', 'ASC')
      .getRawMany<{ date: string; invested: string }>();

    return rows.map((row) => ({ date: row.date, invested: Number(row.invested) }));
  }

  private todayRange(): [Date, Date] {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
    return [start, end];
  }
}
