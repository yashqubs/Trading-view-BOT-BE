import { ExecutionContext, ForbiddenException } from '@nestjs/common';
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

  it('rejects a state-changing request with a session cookie but no CSRF header', () => {
    const context = buildContext({
      method: 'PATCH',
      path: '/rules',
      cookies: { access_token: 'jwt', csrf_token: 'abc123' },
      headers: {},
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects a mismatched CSRF cookie/header pair', () => {
    const context = buildContext({
      method: 'PATCH',
      path: '/rules',
      cookies: { access_token: 'jwt', csrf_token: 'abc123' },
      headers: { 'x-csrf-token': 'different' },
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows a matching CSRF cookie/header pair', () => {
    const context = buildContext({
      method: 'PATCH',
      path: '/rules',
      cookies: { access_token: 'jwt', csrf_token: 'abc123' },
      headers: { 'x-csrf-token': 'abc123' },
    });
    expect(guard.canActivate(context)).toBe(true);
  });
});
