import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Direction, TradeStatus } from '../../common/enums';

@Entity('trade_log')
export class TradeLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20, name: 'tv_ticker' })
  tvTicker: string;

  @Column({ type: 'varchar', length: 60, nullable: true, name: 'ig_epic' })
  igEpic: string | null;

  @Column({ type: 'varchar', length: 4 })
  direction: Direction;

  @Column({ type: 'decimal', precision: 12, scale: 4, name: 'signal_price' })
  signalPrice: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    name: 'investment_amount',
  })
  investmentAmount: string | null;

  @Column({
    type: 'decimal',
    precision: 15,
    scale: 4,
    nullable: true,
    name: 'closing_price',
  })
  closingPrice: string | null;

  @Column({
    type: 'decimal',
    precision: 15,
    scale: 2,
    nullable: true,
    name: 'profit_loss',
  })
  profitLoss: string | null;

  @Column({
    type: 'decimal',
    precision: 8,
    scale: 4,
    nullable: true,
    name: 'profit_loss_pct',
  })
  profitLossPct: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true })
  quantity: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'deal_reference' })
  dealReference: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'deal_id' })
  dealId: string | null;

  @Column({ type: 'varchar', length: 30 })
  status: TradeStatus;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'skip_reason' })
  skipReason: string | null;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string | null;

  @Column({ type: 'timestamptz', name: 'signal_received_at' })
  signalReceivedAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'executed_at' })
  executedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
