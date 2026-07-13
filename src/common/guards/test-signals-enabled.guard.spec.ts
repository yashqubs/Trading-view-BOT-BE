import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TestSignalsEnabledGuard } from './test-signals-enabled.guard';

function buildGuard(value: string | undefined): TestSignalsEnabledGuard {
  const configService = { get: () => value } as unknown as ConfigService;
  return new TestSignalsEnabledGuard(configService);
}

describe('TestSignalsEnabledGuard', () => {
  it('allows the request when ENABLE_TEST_SIGNALS is exactly "true"', () => {
    const guard = buildGuard('true');

    expect(guard.canActivate()).toBe(true);
  });

  it('fails closed when ENABLE_TEST_SIGNALS is unset', () => {
    const guard = buildGuard(undefined);

    expect(() => guard.canActivate()).toThrow(ForbiddenException);
  });

  it('fails closed on any value other than the exact string "true"', () => {
    const guard = buildGuard('TRUE');

    expect(() => guard.canActivate()).toThrow(ForbiddenException);
  });
});
