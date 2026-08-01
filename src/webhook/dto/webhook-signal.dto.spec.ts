// Needed standalone here: main.ts imports this globally at boot for the real
// app, but a DTO spec run in isolation never goes through that bootstrap, and
// class-transformer's @Type decorators rely on Reflect.getMetadata existing.
import 'reflect-metadata';
import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { Direction } from '../../common/enums';
import { WebhookSignalDto } from './webhook-signal.dto';

// Runs the exact pipe the route declares (webhook.controller.ts) rather than a
// bare validate() — what's under test here is the pipe *configuration*
// (whitelist on, forbidNonWhitelisted off), which validate() alone wouldn't
// exercise. A regression on that config is invisible in unit terms and shows
// up in production as silently dropped trades.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: false,
  transform: true,
});

const metadata: ArgumentMetadata = { type: 'body', metatype: WebhookSignalDto, data: undefined };

function transform(body: Record<string, unknown>): Promise<WebhookSignalDto> {
  return pipe.transform(body, metadata) as Promise<WebhookSignalDto>;
}

// The alert message configured in TradingView as of 2026-08-01 (Section 14).
const LIVE_ALERT = {
  secret: 'webhook-secret-value',
  ticker: 'OILUSD',
  action: 'BUY',
  price: '85.46',
  interval: '5',
  time: '2026-08-01T02:23:00Z',
  indicator: 'Profit Investment',
};

describe('WebhookSignalDto', () => {
  it('accepts the live alert message and coerces the quoted price to a number', async () => {
    const dto = await transform({ ...LIVE_ALERT });

    expect(dto.ticker).toBe('OILUSD');
    expect(dto.action).toBe(Direction.BUY);
    expect(dto.price).toBe(85.46);
    expect(dto.interval).toBe('5');
    expect(dto.time).toBe('2026-08-01T02:23:00Z');
    expect(dto.indicator).toBe('Profit Investment');
  });

  it('accepts the SELL variant of the same message', async () => {
    const dto = await transform({ ...LIVE_ALERT, action: 'SELL' });

    expect(dto.action).toBe(Direction.SELL);
  });

  // The contextual fields are optional on purpose: an alert still configured
  // with the pre-2026-08-01 four-field template must keep trading.
  it('accepts the older message with no interval/time/indicator', async () => {
    const dto = await transform({
      secret: LIVE_ALERT.secret,
      ticker: 'AAPL',
      action: 'SELL',
      price: '212.5',
    });

    expect(dto.price).toBe(212.5);
    expect(dto.interval).toBeUndefined();
    expect(dto.time).toBeUndefined();
    expect(dto.indicator).toBeUndefined();
  });

  // The alert template lives in TradingView, so a new field can appear on a
  // running server with no deploy. Tolerate it — but strip it, so nothing
  // unvetted reaches the signal pipeline.
  it('tolerates an unknown field and strips it rather than rejecting the signal', async () => {
    const dto = await transform({ ...LIVE_ALERT, strategyVersion: 'v3', bar_index: 4821 });
    const received = dto as unknown as Record<string, unknown>;

    expect(dto.ticker).toBe('OILUSD');
    expect(received.strategyVersion).toBeUndefined();
    expect(received.bar_index).toBeUndefined();
  });

  it.each([
    ['an unknown action', { action: 'HOLD' }],
    ['a non-numeric price', { price: 'n/a' }],
    ['a zero price', { price: '0' }],
    ['an empty ticker', { ticker: '' }],
  ])('still rejects %s', async (_label, override) => {
    await expect(transform({ ...LIVE_ALERT, ...override })).rejects.toThrow(BadRequestException);
  });
});
