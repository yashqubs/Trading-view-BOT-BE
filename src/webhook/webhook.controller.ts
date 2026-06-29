import { Body, Controller, HttpCode, HttpStatus, Logger, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { TradingViewIpGuard } from '../common/guards/trading-view-ip.guard';
import { WebhookSecretGuard } from '../common/guards/webhook-secret.guard';
import { SignalService } from '../signal/signal.service';
import { SignalInput } from '../trade/interfaces/signal-input.interface';
import { WebhookSignalDto } from './dto/webhook-signal.dto';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly signalService: SignalService) {}

  /**
   * TradingView requires a response within 3 seconds or it cancels the
   * webhook. We acknowledge immediately and process the signal in the
   * background — never await processSignal() here.
   */
  @Post('signal')
  @UseGuards(TradingViewIpGuard, WebhookSecretGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  receiveSignal(@Body() dto: WebhookSignalDto): { received: true } {
    const input: SignalInput = {
      tvTicker: dto.ticker,
      direction: dto.action,
      signalPrice: dto.price,
      signalReceivedAt: new Date(),
    };

    void this.signalService.processSignal(input).catch((error: Error) => {
      this.logger.error(`Unhandled error processing signal for ${dto.ticker}`, error.stack);
    });

    return { received: true };
  }
}
