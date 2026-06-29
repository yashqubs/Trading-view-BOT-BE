import { Global, Module } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { TradingViewIpGuard } from './guards/trading-view-ip.guard';
import { WebhookSecretGuard } from './guards/webhook-secret.guard';

@Global()
@Module({
  providers: [JwtAuthGuard, RolesGuard, TradingViewIpGuard, WebhookSecretGuard],
  exports: [JwtAuthGuard, RolesGuard, TradingViewIpGuard, WebhookSecretGuard],
})
export class CommonModule {}
