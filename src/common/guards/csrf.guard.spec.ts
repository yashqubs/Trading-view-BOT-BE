import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { EXPIRED_JWT, LIVE_JWT } from '../../auth/session/access-token.spec-helpers';
import { CsrfGuard } from './csrf.guard';

interface FakeRequest {
  method: string;
  path: string;
  cookies: Record<string, string>;
  headers: Record<string, string>;
}

function buildContext(request: FakeRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
  let guard: CsrfGuard;

  beforeEach(() => {
    guard = new CsrfGuard();
  });

  it('allows GET requests through without a token', () => {
    const context = buildContext({ method: 'GET', path: '/trades', cookies: {}, headers: {} });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows requests with no session cookie yet (e.g. login)', () => {
    const context = buildContext({
      method: 'POST',
      path: '/auth/login',
      cookies: {},
      headers: {},
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows the webhook endpoint through regardless of CSRF headers', () => {
    const context = buildContext({
      method: 'POST',
      path: '/webhook/signal',
      cookies: { access_token: 'jwt' },
      headers: {},
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows login even when a stale access_token cookie is present without a CSRF header', () => {
    // A leftover cookie from an expired session must never lock the user
    // out of logging in again — login authorizes by credentials, not session.
    const context = buildContext({
      method: 'POST',
      path: '/api/auth/login',
      cookies: { access_token: EXPIRED_JWT },
      headers: {},
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows refresh with an access_token cookie but no CSRF header', () => {
    const context = buildContext({
      method: 'POST',
      path: '/api/auth/refresh',
      cookies: { access_token: EXPIRED_JWT, refresh_token: 'opaque' },
      headers: {},
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows logout with a stale access_token cookie and no CSRF cookie left', () => {
    // Logout is the server-side way to clean up a broken cookie jar, so it
    // has to work with one. Blocking it here is what forced users to clear
    // cookies by hand to get back in.
    const context = buildContext({
      method: 'POST',
      path: '/api/auth/logout',
      cookies: { access_token: EXPIRED_JWT },
      headers: {},
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  describe('when the access_token cookie is not a live session', () => {
    // The lockout this guard caused: a dead access_token still counted as "a
    // session exists", so the guard demanded an X-CSRF-Token and answered 403.
    // A 403 short-circuits the request before JwtAuthGuard can turn it into the
    // 401 that GlobalExceptionFilter uses to evict stale cookies — so the jar
    // could never heal, and every state-changing request failed identically
    // until the user cleared cookies by hand.
    //
    // Waiving is safe: every non-exempt state-changing route is JwtAuthGuard'd,
    // so these requests still 401. They just get there honestly now.
    it.each([
      ['expired', EXPIRED_JWT],
      ['not a JWT at all', 'garbage-left-by-something-else'],
      ['empty', ''],
    ])('waives the check when the token is %s', (_label, accessToken) => {
      const context = buildContext({
        method: 'PATCH',
        path: '/rules',
        cookies: { access_token: accessToken, csrf_token: 'abc123' },
        headers: {},
      });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('waives it even when a duplicate csrf cookie shadows the real one', () => {
      // cookie-parser keeps the first of two same-named cookies, and the
      // browser sends a host-only leftover ahead of the domain-scoped one — so
      // the value checked here can never match the header the frontend read.
      const context = buildContext({
        method: 'PATCH',
        path: '/rules',
        cookies: { access_token: EXPIRED_JWT, csrf_token: 'stale-host-only' },
        headers: { 'x-csrf-token': 'fresh-domain-scoped' },
      });
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  it('still rejects non-exempt auth routes without a CSRF header (e.g. 2fa enable)', () => {
    const context = buildContext({
      method: 'POST',
      path: '/api/auth/2fa/enable',
      cookies: { access_token: LIVE_JWT, csrf_token: 'abc123' },
      headers: {},
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects a state-changing request with a live session but no CSRF header', () => {
    const context = buildContext({
      method: 'PATCH',
      path: '/rules',
      cookies: { access_token: LIVE_JWT, csrf_token: 'abc123' },
      headers: {},
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects a mismatched CSRF cookie/header pair', () => {
    const context = buildContext({
      method: 'PATCH',
      path: '/rules',
      cookies: { access_token: LIVE_JWT, csrf_token: 'abc123' },
      headers: { 'x-csrf-token': 'different' },
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows a matching CSRF cookie/header pair', () => {
    const context = buildContext({
      method: 'PATCH',
      path: '/rules',
      cookies: { access_token: LIVE_JWT, csrf_token: 'abc123' },
      headers: { 'x-csrf-token': 'abc123' },
    });
    expect(guard.canActivate(context)).toBe(true);
  });
});
