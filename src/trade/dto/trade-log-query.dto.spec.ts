// Needed standalone here: main.ts imports this globally at boot for the real
// app, but a DTO spec run in isolation never goes through that bootstrap, and
// class-transformer's @Type/@Transform decorators rely on Reflect.getMetadata
// existing.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TradeStatus } from '../../common/enums';
import { TradeLogQueryDto } from './trade-log-query.dto';

// Exercises the same transform + validate pipeline Nest's ValidationPipe runs
// (transform: true), since the @Transform on `status` is exactly the kind of
// thing that looks right in isolation but silently misbehaves once
// class-validator's decorator ordering gets involved.
async function parse(query: Record<string, unknown>) {
  const dto = plainToInstance(TradeLogQueryDto, query);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('TradeLogQueryDto — status', () => {
  it('leaves status undefined when omitted', async () => {
    const { dto, errors } = await parse({});

    expect(dto.status).toBeUndefined();
    expect(errors).toHaveLength(0);
  });

  it('normalizes a single status into a one-element array', async () => {
    const { dto, errors } = await parse({ status: 'FAILED' });

    expect(dto.status).toEqual([TradeStatus.FAILED]);
    expect(errors).toHaveLength(0);
  });

  it('splits a comma-separated status list — the portal default (executed only)', async () => {
    const { dto, errors } = await parse({ status: 'SUCCESS,FAILED' });

    expect(dto.status).toEqual([TradeStatus.SUCCESS, TradeStatus.FAILED]);
    expect(errors).toHaveLength(0);
  });

  it('trims whitespace around comma-separated values', async () => {
    const { dto } = await parse({ status: 'SUCCESS, FAILED' });

    expect(dto.status).toEqual([TradeStatus.SUCCESS, TradeStatus.FAILED]);
  });

  it('normalizes repeated query keys (status=A&status=B → string[])', async () => {
    // Express/Nest already hands the query pipe an array for repeated keys —
    // simulate that shape directly.
    const { dto, errors } = await parse({ status: ['SUCCESS', 'FAILED'] });

    expect(dto.status).toEqual([TradeStatus.SUCCESS, TradeStatus.FAILED]);
    expect(errors).toHaveLength(0);
  });

  it('treats an empty string as "no filter", not "match nothing"', async () => {
    const { dto, errors } = await parse({ status: '' });

    expect(dto.status).toBeUndefined();
    expect(errors).toHaveLength(0);
  });

  it('rejects an unknown status value', async () => {
    const { errors } = await parse({ status: 'NOT_A_REAL_STATUS' });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('status');
  });

  it('rejects a comma list containing one unknown value', async () => {
    const { errors } = await parse({ status: 'SUCCESS,NOT_A_REAL_STATUS' });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('status');
  });
});
