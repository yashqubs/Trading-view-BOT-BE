import { ArgumentsHost, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { GlobalExceptionFilter } from './http-exception.filter';

interface FakeRequest {
  method: string;
  url: string;
  path: string;
  cookies: Record<string, string>;
}

function buildHost(request: FakeRequest) {
  const response = {
    clearCookie: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

function requestFor(path: string, cookies: Record<string, string>): FakeRequest {
  return { method: 'GET', url: path, path, cookies };
}

function clearedCookieNames(response: { clearCookie: jest.Mock }): string[] {
  return response.clearCookie.mock.calls.map((call) => call[0] as string);
}

describe('GlobalExceptionFilter — stale session cookie cleanup', () => {
  it('evicts the rejected access_token (and csrf) so it cannot lock the user out', () => {
    // A dead access_token left in the browser makes CsrfGuard stop waiving the
    // double-submit check, which used to leave the portal unusable until the
    // user cleared cookies manually.
    const { host, response } = buildHost(requestFor('/api/auth/me', { access_token: 'expired' }));

    new GlobalExceptionFilter().catch(new UnauthorizedException(), host);

    expect(clearedCookieNames(response)).toEqual(['access_token', 'csrf_token']);
    expect(response.status).toHaveBeenCalledWith(401);
  });

  it('leaves a recoverable session alone while a refresh cookie is still present', () => {
    // An expired access token with a live refresh token is the normal state
    // every 15 minutes. A burst of requests all 401 together when it lapses,
    // and a slow one landing after the refresh already installed fresh
    // cookies would wipe them — logging the user out for real.
    const { host, response } = buildHost(
      requestFor('/api/auth/me', { access_token: 'expired', refresh_token: 'opaque' }),
    );

    new GlobalExceptionFilter().catch(new UnauthorizedException(), host);

    expect(response.clearCookie).not.toHaveBeenCalled();
  });

  it('also clears the domain-scoped csrf_token when CSRF_COOKIE_DOMAIN is set', () => {
    const { host, response } = buildHost(requestFor('/api/auth/me', { access_token: 'expired' }));

    new GlobalExceptionFilter('.qubs.co.uk').catch(new UnauthorizedException(), host);

    expect(response.clearCookie).toHaveBeenCalledWith('csrf_token');
    expect(response.clearCookie).toHaveBeenCalledWith('csrf_token', { domain: '.qubs.co.uk' });
  });

  it('leaves cookies alone when /auth/refresh 401s — the loser of a rotation race', () => {
    // The winning tab has already installed fresh cookies in the shared jar;
    // clearing here would log every tab out over a race the frontend recovers
    // from on its own.
    const { host, response } = buildHost(
      requestFor('/api/auth/refresh', { access_token: 'expired', refresh_token: 'used' }),
    );

    new GlobalExceptionFilter().catch(new UnauthorizedException('Session expired'), host);

    expect(response.clearCookie).not.toHaveBeenCalled();
  });

  it('leaves cookies alone when login 401s on a wrong password', () => {
    const { host, response } = buildHost(requestFor('/api/auth/login', { access_token: 'live' }));

    new GlobalExceptionFilter().catch(new UnauthorizedException('Invalid email or password'), host);

    expect(response.clearCookie).not.toHaveBeenCalled();
  });

  it('does nothing when the request carried no access_token cookie', () => {
    const { host, response } = buildHost(requestFor('/api/auth/me', {}));

    new GlobalExceptionFilter().catch(new UnauthorizedException(), host);

    expect(response.clearCookie).not.toHaveBeenCalled();
  });

  it('drops the access half on a CSRF rejection so the mismatch cannot persist', () => {
    // A CSRF 403 means the csrf_token cookie and the header disagree, and the
    // client cannot repair that: it can neither read the httpOnly half of the
    // jar nor mint a replacement. Every later mutation then 403s identically
    // until the cookie's max-age runs out — the "everything errors until I
    // clear cookies" state. Dropping the access half turns the next request
    // into a 401, which the refresh cookie silently renews, reissuing
    // access_token and csrf_token together and back in sync.
    const { host, response } = buildHost(
      requestFor('/api/rules', { access_token: 'live', refresh_token: 'opaque' }),
    );

    new GlobalExceptionFilter().catch(
      new ForbiddenException('Invalid or missing CSRF token'),
      host,
    );

    expect(clearedCookieNames(response)).toEqual(['access_token', 'csrf_token']);
    expect(response.status).toHaveBeenCalledWith(403);
  });

  it('clears on a CSRF rejection even with a refresh cookie present', () => {
    // Unlike the 401 path, this needs no refresh-race guard: a renewed session
    // gets a fresh cookie and a matching header on the retry, so a CSRF 403 is
    // never the tail of a successful refresh. Gating it on the refresh cookie
    // being absent is what left the common case — a live session with a
    // poisoned csrf cookie — with no way out at all.
    const { host, response } = buildHost(
      requestFor('/api/trades/close-all-positions', {
        access_token: 'live',
        refresh_token: 'opaque',
        csrf_token: 'shadowed',
      }),
    );

    new GlobalExceptionFilter('.qubs.co.uk').catch(
      new ForbiddenException('Invalid or missing CSRF token'),
      host,
    );

    expect(response.clearCookie).toHaveBeenCalledWith('access_token');
    expect(response.clearCookie).toHaveBeenCalledWith('csrf_token', { domain: '.qubs.co.uk' });
  });

  it('leaves cookies alone on the pending-session 403, which is a healthy session', () => {
    // JwtAuthGuard throws this when a user still owes a password change. The
    // session is fine; tearing its cookies down would break the very flow the
    // 403 is steering them into.
    const { host, response } = buildHost(requestFor('/api/rules', { access_token: 'live' }));

    new GlobalExceptionFilter().catch(
      new ForbiddenException('Finish setting up 2FA and changing your password to continue'),
      host,
    );

    expect(response.clearCookie).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
  });

  it('does not clear cookies on unrelated failures', () => {
    const { host, response } = buildHost(requestFor('/api/rules', { access_token: 'live' }));

    new GlobalExceptionFilter().catch(new Error('boom'), host);

    expect(response.clearCookie).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(500);
  });
});
