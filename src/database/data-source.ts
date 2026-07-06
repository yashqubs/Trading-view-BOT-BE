import { DataSource } from 'typeorm';
import { User } from '../user/entities/user.entity';
import { TokenBlacklist } from '../auth/entities/token-blacklist.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { Market } from '../markets/entities/market.entity';
import { StockMapping } from '../mapping/entities/stock-mapping.entity';
import { TradingRules } from '../trading-rules/entities/trading-rules.entity';
import { TradeLog } from '../trade/entities/trade-log.entity';
import { loadEnvFile } from './load-env';

loadEnvFile();

// CLI-only data source for running migrations. DB_PASSWORD comes from .env in
// local dev, or is fetched from AWS Secrets Manager by run-migrations.ts in
// production before this module is imported.
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME ?? 'trading_view_bot',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME ?? 'trading_view_bot',
  entities: [User, TokenBlacklist, RefreshToken, Market, StockMapping, TradingRules, TradeLog],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
});
