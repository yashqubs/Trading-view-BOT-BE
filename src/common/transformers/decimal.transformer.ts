import { ValueTransformer } from 'typeorm';

// node-postgres returns Postgres numeric/decimal columns as strings by
// default (avoids float precision loss at the driver level), and TypeORM
// does not convert them — every decimal column needs this transformer or it
// silently hands callers a string typed as a number. The frontend's
// TypeScript types (Trading-view-BOT-FE/src/types/index.ts) declare these
// fields as `number`; without this, `.toFixed()` calls there
// (src/lib/format.ts) throw at runtime on the raw string.
export const decimalTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value === null || value === undefined ? null : Number(value)),
};
