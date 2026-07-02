import { Column, Entity, PrimaryColumn, UpdateDateColumn, ValueTransformer } from 'typeorm';
import { decimalTransformer } from '../../common/transformers/decimal.transformer';

// Postgres `time` columns round-trip as "HH:MM:SS" — the API contract (and
// the input DTO) only deals in "HH:MM", so trim seconds on the way out.
const timeOfDayTransformer: ValueTransformer = {
  to: (value: string) => value,
  from: (value: string | null) => (value ? value.slice(0, 5) : value),
};

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

  @Column({ type: 'int', nullable: true, name: 'max_open_positions_global' })
  maxOpenPositionsGlobal: number | null;

  @Column({ type: 'int', default: 3, name: 'max_consecutive_failures' })
  maxConsecutiveFailures: number;

  @Column({ type: 'int', default: 0, name: 'consecutive_failure_count' })
  consecutiveFailureCount: number;

  @Column({
    type: 'time',
    default: '14:30:00',
    name: 'trade_start_time_utc',
    transformer: timeOfDayTransformer,
  })
  tradeStartTimeUtc: string;

  @Column({
    type: 'time',
    default: '21:00:00',
    name: 'trade_end_time_utc',
    transformer: timeOfDayTransformer,
  })
  tradeEndTimeUtc: string;

  @Column({ type: 'boolean', default: true, name: 'trade_weekdays_only' })
  tradeWeekdaysOnly: boolean;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @Column({ type: 'uuid', nullable: true, name: 'updated_by' })
  updatedBy: string | null;
}
