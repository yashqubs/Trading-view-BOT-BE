import { ClassSerializerInterceptor, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './database/database.module';
import { IgClientModule } from './ig-client/ig-client.module';
import { MappingModule } from './mapping/mapping.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { SecretsModule } from './secrets/secrets.module';
import { SignalModule } from './signal/signal.module';
import { StatsModule } from './stats/stats.module';
import { SystemModule } from './system/system.module';
import { TradeModule } from './trade/trade.module';
import { TradingRulesModule } from './trading-rules/trading-rules.module';
import { UserModule } from './user/user.module';
import { WebhookModule } from './webhook/webhook.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    CommonModule,
    SecretsModule,
    DatabaseModule,
    AuthModule,
    UserModule,
    IgClientModule,
    MappingModule,
    TradingRulesModule,
    TradeModule,
    SignalModule,
    WebhookModule,
    StatsModule,
    SchedulerModule,
    SystemModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
  ],
})
export class AppModule {}
