import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TestSignalsEnabledGuard } from '../common/guards/test-signals-enabled.guard';
import { IgClientService } from '../ig-client/ig-client.service';
import { IgDebugEntry } from '../ig-client/ig-client.types';
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
  constructor(
    private readonly signalService: SignalService,
    private readonly igClientService: IgClientService,
  ) {}

  // igDebug is the raw HTTP exchange with IG for this one test signal (empty
  // if the signal never reached IG — e.g. skipped by an earlier condition).
  // Dev-only visibility into exactly what we sent/received, to settle
  // questions no amount of documentation-reading could (see Section 9
  // "Price scaling" — this endpoint is how we verified size/point semantics
  // live). Never exposed on the real webhook path.
  @Post('test')
  async test(@Body() dto: TestSignalDto): Promise<TradeLog & { igDebug: IgDebugEntry[] }> {
    this.igClientService.startRecording();
    try {
      const trade = await this.signalService.processSignal({
        tvTicker: dto.tvTicker,
        direction: dto.direction,
        signalPrice: dto.price,
        signalReceivedAt: new Date(),
        investmentAmountOverride: dto.investmentAmount,
        executionModeOverride: dto.executionMode,
        maxSlippagePercentOverride: dto.maxSlippagePercent,
      });
      return { ...trade, igDebug: this.igClientService.stopRecording() };
    } catch (error) {
      this.igClientService.stopRecording();
      throw error;
    }
  }
}
