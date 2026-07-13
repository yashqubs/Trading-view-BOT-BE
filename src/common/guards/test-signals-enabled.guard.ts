import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Fails closed — `ENABLE_TEST_SIGNALS` must be explicitly set to the string
 * 'true'. Guards the dev-only manual signal endpoint (POST /signal/test),
 * which runs the real condition pipeline and can place real IG orders if
 * IG_BASE_URL points at the live API rather than demo. Never enable this in
 * production.
 */
@Injectable()
export class TestSignalsEnabledGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(): boolean {
    const enabled = this.configService.get<string>('ENABLE_TEST_SIGNALS') === 'true';
    if (!enabled) {
      throw new ForbiddenException('Test signals are disabled');
    }
    return true;
  }
}
