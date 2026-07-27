import { Controller, Get, HttpCode, HttpStatus, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TradeLogQueryDto } from './dto/trade-log-query.dto';
import { CloseAllPositionsResult, PaginatedTradeLogs, TradeService } from './trade.service';
import { tradeLogsToCsv } from './utils/trade-log-csv.util';

// Places real market orders against every open position, so it's rate-limited
// well below the global default. Nobody has a legitimate reason to flatten the
// book several times a minute.
const CLOSE_ALL_THROTTLE = { default: { limit: 3, ttl: 60_000 } };

@Controller('trades')
@UseGuards(JwtAuthGuard)
export class TradeController {
  constructor(private readonly tradeService: TradeService) {}

  @Get()
  findAll(@Query() query: TradeLogQueryDto): Promise<PaginatedTradeLogs> {
    return this.tradeService.findAll(query);
  }

  /**
   * Closes every position open on IG, at market. Returns a summary rather than
   * failing outright on a partial result — some positions closing and others
   * not is a normal outcome (one instrument halted, say), and the caller needs
   * to know which is which.
   */
  @Post('close-all-positions')
  @Throttle(CLOSE_ALL_THROTTLE)
  @HttpCode(HttpStatus.OK)
  closeAllPositions(): Promise<CloseAllPositionsResult> {
    return this.tradeService.closeAllOpenPositions();
  }

  @Get('export')
  async exportCsv(@Query() query: TradeLogQueryDto, @Res() response: Response): Promise<void> {
    const trades = await this.tradeService.findAllForExport(query);
    const csv = tradeLogsToCsv(trades);

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="trades.csv"');
    response.send(csv);
  }
}
