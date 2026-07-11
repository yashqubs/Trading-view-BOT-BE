import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../user/entities/user.entity';
import { TokenBlacklist } from '../auth/entities/token-blacklist.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { StockMapping } from '../mapping/entities/stock-mapping.entity';
import { TradingRules } from '../trading-rules/entities/trading-rules.entity';
import { TradeLog } from '../trade/entities/trade-log.entity';
import { SecretsModule } from '../secrets/secrets.module';
import { SecretsService } from '../secrets/secrets.service';

@Module({
  imports: [
    SecretsModule,
    TypeOrmModule.forRootAsync({
      imports: [SecretsModule],
      inject: [ConfigService, SecretsService],
      useFactory: async (configService: ConfigService, secretsService: SecretsService) => {
        await secretsService.ensureLoaded();
        return {
          type: 'postgres' as const,
          host:
            secretsService.getOptionalString('DB_HOST') ??
            configService.get<string>('DB_HOST', '127.0.0.1'),
          port: Number(
            secretsService.getOptionalString('DB_PORT') ??
              configService.get<number>('DB_PORT', 5432),
          ),
          username:
            secretsService.getOptionalString('DB_USERNAME') ??
            configService.get<string>('DB_USERNAME', 'trading_view_bot'),
          password: secretsService.get('DB_PASSWORD'),
          database:
            secretsService.getOptionalString('DB_NAME') ??
            configService.get<string>('DB_NAME', 'trading_view_bot'),
          entities: [User, TokenBlacklist, RefreshToken, StockMapping, TradingRules, TradeLog],
          synchronize: false,
          migrationsRun: false,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
