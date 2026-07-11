import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { ExecutionMode } from '../../common/enums';
import { decimalTransformer } from '../../common/transformers/decimal.transformer';

@Entity('trading_rules')
export class TradingRules {
  @PrimaryColumn({ type: 'int', default: 1 })
  id: number;

  @Column({ type: 'boolean', default: true, name: 'bot_enabled' })
  botEnabled: boolean;

  /** True when bot_enabled was flipped off automatically by the failure-threshold auto-pause, as opposed to a manual admin toggle. */
  @Column({ type: 'boolean', default: false, name: 'auto_paused' })
  autoPaused: boolean;

  @Column({ type: 'boolean', default: true, name: 'allow_buy' })
  allowBuy: boolean;

  @Column({ type: 'boolean', default: true, name: 'allow_sell' })
  allowSell: boolean;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    name: 'daily_max_total_investment',
    transformer: decimalTransformer,
  })
  dailyMaxTotalInvestment: number | null;

  @Column({ type: 'int', nullable: true, name: 'daily_max_trade_count' })
  dailyMaxTradeCount: number | null;

  @Column({ type: 'int', default: 3, name: 'max_consecutive_failures' })
  maxConsecutiveFailures: number;

  @Column({ type: 'int', default: 0, name: 'consecutive_failure_count' })
  consecutiveFailureCount: number;

  // Global default execution mode. A stock's own execution_mode (nullable,
  // on stock_mapping) overrides this when set; when null, the stock
  // inherits this value.
  @Column({
    type: 'varchar',
    length: 20,
    default: ExecutionMode.MARKET,
    name: 'execution_mode',
  })
  executionMode: ExecutionMode;

  // Only applies to SIGNAL_PRICE mode — the tolerance around the signal
  // price the LIMIT order's level is allowed to move against the trade
  // before it's rejected instead of filled. 0 (the default) means "exact
  // signal price only", identical to behavior before this setting existed.
  // A stock's own max_slippage_percent (nullable, on stock_mapping)
  // overrides this when set; when null, the stock inherits this value.
  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0,
    name: 'max_slippage_percent',
    transformer: decimalTransformer,
  })
  maxSlippagePercent: number;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @Column({ type: 'uuid', nullable: true, name: 'updated_by' })
  updatedBy: string | null;
}
