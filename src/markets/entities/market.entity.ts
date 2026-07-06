import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  ValueTransformer,
} from 'typeorm';

// Postgres `time` columns round-trip as "HH:MM:SS" — the API contract (and
// the input DTOs) only deal in "HH:MM", so trim seconds on the way out.
// Duplicated from trading-rules.entity.ts rather than shared — same reason
// small constants like BCRYPT_COST are duplicated elsewhere in this repo.
const timeOfDayTransformer: ValueTransformer = {
  to: (value: string) => value,
  from: (value: string | null) => (value ? value.slice(0, 5) : value),
};

// A trading-hours profile (name + IANA timezone + open/close time +
// weekdays-only) that a stock is assigned to — e.g. "UK", "US", "India".
// NOT related to IgMarket (ig-client.types.ts), which is an IG instrument
// search result. Two unrelated concepts that happen to share the word
// "market".
@Entity('markets')
export class Market {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 100, unique: true })
  name: string;

  @Column({ type: 'varchar', length: 100 })
  timezone: string;

  @Column({ type: 'time', name: 'open_time', transformer: timeOfDayTransformer })
  openTime: string;

  @Column({ type: 'time', name: 'close_time', transformer: timeOfDayTransformer })
  closeTime: string;

  @Column({ type: 'boolean', default: true, name: 'weekdays_only' })
  weekdaysOnly: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
