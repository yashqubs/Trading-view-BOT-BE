import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Direction, TradeStatus } from '../common/enums';
import { IgClientService } from '../ig-client/ig-client.service';
import { MappingService } from '../mapping/mapping.service';
import { TradeLog } from '../trade/entities/trade-log.entity';
import { TradingRulesService } from '../trading-rules/trading-rules.service';
import {
  DailyActivityPoint,
  OverviewStats,
  StatusBreakdownPoint,
  StockActivity,
  StockStats,
} from './interfaces/stats.interfaces';

const EXECUTED_STATUSES = [TradeStatus.SUCCESS, TradeStatus.FAILED];

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(TradeLog) private readonly tradeLogRepository: Repository<TradeLog>,
    private readonly tradingRulesService: TradingRulesService,
    private readonly igClientService: IgClientService,
    private readonly mappingService: MappingService,
  ) {}

  async overview(): Promise<OverviewStats> {
    const rules = await this.tradingRulesService.get();
    const [start, end] = this.todayRange();

    const [
      totalTrades,
      todaysTrades,
      successCount,
      todaysInvestedRaw,
      directionCounts,
      openPositions,
    ] = await Promise.all([
      this.tradeLogRepository.count({ where: { status: In(EXECUTED_STATUSES) } }),
      this.tradeLogRepository
        .createQueryBuilder('trade')
        .where('trade.status IN (:...statuses)', { statuses: EXECUTED_STATUSES })
        .andWhere('trade.createdAt BETWEEN :start AND :end', { start, end })
        .getCount(),
      this.tradeLogRepository.count({ where: { status: TradeStatus.SUCCESS } }),
      this.tradeLogRepository
        .createQueryBuilder('trade')
        .select('COALESCE(SUM(trade.investmentAmount), 0)', 'total')
        .where('trade.status = :status', { status: TradeStatus.SUCCESS })
        .andWhere('trade.createdAt BETWEEN :start AND :end', { start, end })
        .getRawOne<{ total: string }>(),
      this.tradeLogRepository
        .createQueryBuilder('trade')
        .select('SUM(CASE WHEN trade.direction = :buy THEN 1 ELSE 0 END)', 'buyCount')
        .addSelect('SUM(CASE WHEN trade.direction = :sell THEN 1 ELSE 0 END)', 'sellCount')
        .where('trade.status IN (:...statuses)', { statuses: EXECUTED_STATUSES })
        .setParameters({ buy: Direction.BUY, sell: Direction.SELL })
        .getRawOne<{ buyCount: string; sellCount: string }>(),
      this.igClientService.getOpenPositionCount(),
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

  async dailyActivity(days = 30): Promise<DailyActivityPoint[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await this.tradeLogRepository
      .createQueryBuilder('trade')
      .select("TO_CHAR(trade.createdAt, 'YYYY-MM-DD')", 'date')
      .addSelect('COUNT(*)', 'trades')
      .addSelect(
        'COALESCE(SUM(CASE WHEN trade.status = :success THEN trade.investmentAmount ELSE 0 END), 0)',
        'invested',
      )
      .where('trade.status IN (:...statuses)', { statuses: EXECUTED_STATUSES })
      .andWhere('trade.createdAt >= :since', { since })
      .setParameters({ success: TradeStatus.SUCCESS })
      .groupBy('date')
      .orderBy('date', 'ASC')
      .getRawMany<{ date: string; trades: string; invested: string }>();

    return rows.map((row) => ({
      date: row.date,
      trades: Number(row.trades),
      invested: Number(row.invested),
    }));
  }

  async byStock(): Promise<StockActivity[]> {
    const rows = await this.tradeLogRepository
      .createQueryBuilder('trade')
      .select('trade.tvTicker', 'tvTicker')
      .addSelect('COUNT(*)', 'trades')
      .addSelect(
        'COALESCE(SUM(CASE WHEN trade.status = :success THEN trade.investmentAmount ELSE 0 END), 0)',
        'invested',
      )
      .where('trade.status IN (:...statuses)', { statuses: EXECUTED_STATUSES })
      .setParameters({ success: TradeStatus.SUCCESS })
      .groupBy('trade.tvTicker')
      .orderBy('"trades"', 'DESC')
      .getRawMany<{ tvTicker: string; trades: string; invested: string }>();

    return rows.map((row) => ({
      tvTicker: row.tvTicker,
      trades: Number(row.trades),
      invested: Number(row.invested),
    }));
  }

  async statusBreakdown(): Promise<StatusBreakdownPoint[]> {
    const rows = await this.tradeLogRepository
      .createQueryBuilder('trade')
      .select('trade.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('trade.status')
      .getRawMany<{ status: TradeStatus; count: string }>();

    return rows.map((row) => ({ status: row.status, count: Number(row.count) }));
  }

  async stockDetail(tvTicker: string): Promise<StockStats> {
    const totalsRow = await this.tradeLogRepository
      .createQueryBuilder('trade')
      .select('COUNT(*)', 'totalTrades')
      .addSelect(
        'COALESCE(SUM(CASE WHEN trade.status = :success THEN trade.investmentAmount ELSE 0 END), 0)',
        'totalInvested',
      )
      .addSelect('SUM(CASE WHEN trade.direction = :buy THEN 1 ELSE 0 END)', 'buyCount')
      .addSelect('SUM(CASE WHEN trade.direction = :sell THEN 1 ELSE 0 END)', 'sellCount')
      .addSelect('SUM(CASE WHEN trade.status = :success THEN 1 ELSE 0 END)', 'successCount')
      .where('trade.tvTicker = :tvTicker', { tvTicker })
      .andWhere('trade.status IN (:...statuses)', { statuses: EXECUTED_STATUSES })
      .setParameters({ success: TradeStatus.SUCCESS, buy: Direction.BUY, sell: Direction.SELL })
      .getRawOne<{
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
        this.statusBreakdownFiltered(tvTicker),
        this.timelineFiltered(tvTicker),
        this.entryPricesFiltered(tvTicker),
        this.investedOverTimeFiltered(tvTicker),
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

  private async statusBreakdownFiltered(tvTicker: string): Promise<StatusBreakdownPoint[]> {
    const rows = await this.tradeLogRepository
      .createQueryBuilder('trade')
      .select('trade.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('trade.tvTicker = :tvTicker', { tvTicker })
      .groupBy('trade.status')
      .getRawMany<{ status: TradeStatus; count: string }>();

    return rows.map((row) => ({ status: row.status, count: Number(row.count) }));
  }

  private async timelineFiltered(tvTicker: string): Promise<{ date: string; trades: number }[]> {
    const rows = await this.tradeLogRepository
      .createQueryBuilder('trade')
      .select("TO_CHAR(trade.createdAt, 'YYYY-MM-DD')", 'date')
      .addSelect('COUNT(*)', 'trades')
      .where('trade.tvTicker = :tvTicker', { tvTicker })
      .andWhere('trade.status IN (:...statuses)', { statuses: EXECUTED_STATUSES })
      .groupBy('date')
      .orderBy('date', 'ASC')
      .getRawMany<{ date: string; trades: string }>();

    return rows.map((row) => ({ date: row.date, trades: Number(row.trades) }));
  }

  private async entryPricesFiltered(tvTicker: string): Promise<{ date: string; price: number }[]> {
    const trades = await this.tradeLogRepository.find({
      where: { tvTicker, status: In(EXECUTED_STATUSES) },
      order: { createdAt: 'ASC' },
    });

    return trades.map((trade) => ({
      date: trade.createdAt.toISOString(),
      price: Number(trade.signalPrice),
    }));
  }

  private async investedOverTimeFiltered(
    tvTicker: string,
  ): Promise<{ date: string; invested: number }[]> {
    const rows = await this.tradeLogRepository
      .createQueryBuilder('trade')
      .select("TO_CHAR(trade.createdAt, 'YYYY-MM-DD')", 'date')
      .addSelect('COALESCE(SUM(trade.investmentAmount), 0)', 'invested')
      .where('trade.tvTicker = :tvTicker', { tvTicker })
      .andWhere('trade.status = :status', { status: TradeStatus.SUCCESS })
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
