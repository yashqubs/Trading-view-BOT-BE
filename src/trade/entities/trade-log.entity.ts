import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Direction, TradeStatus } from '../../common/enums';
import { decimalTransformer } from '../../common/transformers/decimal.transformer';

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

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 4,
    name: 'signal_price',
    transformer: decimalTransformer,
  })
  signalPrice: number;

  // The real £ notional actually committed — size × price-in-points — for a
  // BUY that reached a computed size. Always null for SELL (closing an
  // existing position is never a new investment) and for any BUY that never
  // got that far (skipped, or failed before sizing — e.g. too small for
  // IG's minimum deal size). Deliberately NOT the configured investment
  // amount input: that number only reflects intent, and showing it here
  // regardless of what was actually sized/sent to IG was misleading (see
  // the PayPal case 2026-07-14 where "£2,000 invested" was actually
  // ~£90,000+ of real notional under the old shares-based sizing bug).
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    name: 'trade_value',
    transformer: decimalTransformer,
  })
  tradeValue: number | null;

  // IG's `size` — a £-per-point stake for BUY (see calculateSize), or the
  // exact size of the position being closed for SELL. NOT a share count.
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 4,
    nullable: true,
    transformer: decimalTransformer,
  })
  size: number | null;

  // The actual IG fill price (from confirmDeal's `level`) — orders are
  // placed MARKET, not LIMIT, so this can legitimately differ from
  // signal_price. Null for trades that never reached a filled state
  // (skipped, or rejected before/at confirmation).
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 4,
    nullable: true,
    name: 'executed_price',
    transformer: decimalTransformer,
  })
  executedPrice: number | null;

  // The slippage tolerance actually applied to this trade's LIMIT level —
  // recorded at execution time so the history survives later changes to the
  // stock/global settings. Null when the trade ran in MARKET mode (no
  // tolerance applies) or never reached execution.
  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
    name: 'max_slippage_percent',
    transformer: decimalTransformer,
  })
  maxSlippagePercent: number | null;

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
