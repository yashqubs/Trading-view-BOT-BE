import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { decimalTransformer } from '../../common/transformers/decimal.transformer';

@Entity('stock_mapping')
export class StockMapping {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20, unique: true, name: 'tv_ticker' })
  tvTicker: string;

  @Column({ type: 'varchar', length: 60, name: 'ig_epic' })
  igEpic: string;

  @Column({ type: 'varchar', length: 255, name: 'instrument_name' })
  instrumentName: string;

  @Column({ type: 'varchar', length: 50, name: 'instrument_type' })
  instrumentType: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'investment_amount',
    transformer: decimalTransformer,
  })
  investmentAmount: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    name: 'max_daily_spend',
    transformer: decimalTransformer,
  })
  maxDailySpend: number | null;

  @Column({ type: 'int', nullable: true, name: 'cool_down_minutes' })
  coolDownMinutes: number | null;

  @Column({ type: 'int', default: 1, name: 'max_open_positions' })
  maxOpenPositions: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
