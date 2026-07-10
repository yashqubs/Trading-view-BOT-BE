import { Global, Module } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { TradingViewIpGuard } from './guards/trading-view-ip.guard';
import { WebhookSecretGuard } from './guards/webhook-secret.guard';

@Global()
@Module({
  providers: [JwtAuthGuard, TradingViewIpGuard, WebhookSecretGuard],
  exports: [JwtAuthGuard, TradingViewIpGuard, WebhookSecretGuard],
})
export class CommonModule {}
