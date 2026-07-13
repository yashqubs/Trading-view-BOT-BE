import { Global, Module } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { TestSignalsEnabledGuard } from './guards/test-signals-enabled.guard';
import { TradingViewIpGuard } from './guards/trading-view-ip.guard';
import { WebhookSecretGuard } from './guards/webhook-secret.guard';

@Global()
@Module({
  providers: [JwtAuthGuard, TradingViewIpGuard, WebhookSecretGuard, TestSignalsEnabledGuard],
  exports: [JwtAuthGuard, TradingViewIpGuard, WebhookSecretGuard, TestSignalsEnabledGuard],
})
export class CommonModule {}
