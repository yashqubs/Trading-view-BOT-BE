import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { DailyActivityQueryDto } from './dto/daily-activity-query.dto';
import { OpenPositionsQueryDto } from './dto/open-positions-query.dto';
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
import { StatsService } from './stats.service';

@Controller('stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('overview')
  overview(@Query() query: StatsFilterQueryDto): Promise<OverviewStats> {
    return this.statsService.overview(query);
  }

  @Get('daily-activity')
  dailyActivity(@Query() query: DailyActivityQueryDto): Promise<DailyActivityPoint[]> {
    return this.statsService.dailyActivity(query);
  }

  @Get('by-stock')
  byStock(@Query() query: StatsDaysQueryDto): Promise<StockActivity[]> {
    return this.statsService.byStock(query);
  }

  @Get('open-positions')
  openPositions(@Query() query: OpenPositionsQueryDto): Promise<OpenPosition[]> {
    return this.statsService.openPositions(query.ticker);
  }

  @Get('status-breakdown')
  statusBreakdown(@Query() query: StatsFilterQueryDto): Promise<StatusBreakdownPoint[]> {
    return this.statsService.statusBreakdown(query);
  }

  @Get('stock/:ticker')
  stockDetail(
    @Param('ticker') ticker: string,
    @Query() query: StatsDaysQueryDto,
  ): Promise<StockStats> {
    return this.statsService.stockDetail(ticker, query);
  }
}
