import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ExecutionMode } from '../../common/enums';
import { decimalTransformer } from '../../common/transformers/decimal.transformer';

@Entity('stock_mapping')
export class StockMapping {
  @PrimaryGeneratedColumn()
  id: number;

  // Uniqueness enforced case-insensitively at the DB level via a functional
  // index on LOWER(tv_ticker) (migration CaseInsensitiveTvTickerUnique), not
  // via `unique: true` here — a plain column-level unique constraint is
  // case-sensitive in Postgres and would let "SILVER"/"Silver" coexist even
  // though MappingService.findByTicker() treats them as the same ticker.
  @Column({ type: 'varchar', length: 20, name: 'tv_ticker' })
  tvTicker: string;

  @Column({ type: 'varchar', length: 60, name: 'ig_epic' })
  igEpic: string;

  @Column({ type: 'varchar', length: 255, name: 'instrument_name' })
  instrumentName: string;

  @Column({ type: 'varchar', length: 50, name: 'instrument_type' })
  instrumentType: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  // Null = inherit trading_rules.investment_amount (the global default). Set
  // to override just this stock. See resolveInvestmentAmount().
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    name: 'investment_amount',
    transformer: decimalTransformer,
  })
  investmentAmount: number | null;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    name: 'max_daily_spend',
    transformer: decimalTransformer,
  })
  maxDailySpend: number | null;

  // Null = inherit trading_rules.execution_mode (the global default). Set
  // to override just this stock.
  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
    name: 'execution_mode',
  })
  executionMode: ExecutionMode | null;

  // Null = inherit trading_rules.max_slippage_percent (the global default).
  // Set to override just this stock. Independent of executionMode — a stock
  // can override one without the other.
  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
    name: 'max_slippage_percent',
    transformer: decimalTransformer,
  })
  maxSlippagePercent: number | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
