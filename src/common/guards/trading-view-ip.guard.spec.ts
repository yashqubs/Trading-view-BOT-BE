import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TradingViewIpGuard } from './trading-view-ip.guard';

const ALLOWED_IP = '52.89.214.238';

function buildContext(
  headers: Record<string, string>,
  remoteAddress = '203.0.113.9',
): ExecutionContext {
  const request = { headers, ip: undefined, socket: { remoteAddress } };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('TradingViewIpGuard', () => {
  function buildGuard(allowedIps = ALLOWED_IP): TradingViewIpGuard {
    const configService = { get: () => allowedIps } as unknown as ConfigService;
    return new TradingViewIpGuard(configService);
  }

  it('allows a request whose proxy-observed hop is whitelisted', () => {
    const guard = buildGuard();
    const context = buildContext({ 'x-forwarded-for': `10.0.0.1, ${ALLOWED_IP}` });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a spoofed X-Forwarded-For that only forges the client-supplied (leftmost) hop', () => {
    // An attacker can set X-Forwarded-For themselves; only the rightmost
    // entry (appended by our own reverse proxy) can't be forged. If the
    // guard trusted the leftmost entry, this exact payload would bypass it.
    const guard = buildGuard();
    const context = buildContext({ 'x-forwarded-for': `${ALLOWED_IP}, 198.51.100.7` });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects when no X-Forwarded-For header and the raw connection IP is not whitelisted', () => {
    const guard = buildGuard();
    const context = buildContext({}, '198.51.100.7');

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('fails closed (rejects everything) when TRADINGVIEW_IPS is not configured', () => {
    const guard = buildGuard('');
    const context = buildContext({ 'x-forwarded-for': ALLOWED_IP });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
