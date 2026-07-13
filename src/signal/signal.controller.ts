import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TestSignalsEnabledGuard } from '../common/guards/test-signals-enabled.guard';
import { TradeLog } from '../trade/entities/trade-log.entity';
import { TestSignalDto } from './dto/test-signal.dto';
import { SignalService } from './signal.service';

/**
 * Dev-only: lets a logged-in portal user run a signal through the real
 * condition pipeline without waiting for TradingView. Gated by
 * TestSignalsEnabledGuard (ENABLE_TEST_SIGNALS=true), which fails closed —
 * this never runs in production unless someone deliberately enables it.
 *
 * Unlike the real webhook (fire-and-forget, must respond within 3s), this
 * awaits the result and returns it directly — there's no TradingView
 * timeout to respect, and immediate feedback is the whole point of a test
 * tool.
 */
@Controller('signal')
@UseGuards(JwtAuthGuard, TestSignalsEnabledGuard)
export class SignalController {
  constructor(private readonly signalService: SignalService) {}

  @Post('test')
  test(@Body() dto: TestSignalDto): Promise<TradeLog> {
    return this.signalService.processSignal({
      tvTicker: dto.tvTicker,
      direction: dto.direction,
      signalPrice: dto.price,
      signalReceivedAt: new Date(),
    });
  }
}
