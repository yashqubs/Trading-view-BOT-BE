import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { clearStaleAccessCookies } from '../../auth/session/session-cookies';
import { CSRF_ERROR_MESSAGE } from '../guards/csrf.guard';

// A 401 on these paths is not evidence that the caller's session cookie is
// dead, so they must not trigger the stale-cookie cleanup below:
//
//   /auth/refresh — refresh tokens are single-use. When two tabs race at
//     access-token expiry the loser 401s here while the winner has already
//     installed fresh cookies in the browser's shared jar. Clearing on this
//     would wipe the winner's cookies and log every tab out over a race the
//     frontend already recovers from.
//   /auth/login, /auth/login/2fa — these authorize by credentials, not by the
//     cookie. A mistyped password must not tear down a session the user
//     already has open.
//
// Listed with and without the global 'api' prefix because request.path
// includes it at runtime but not in unit tests (same as CsrfGuard).
const PRESERVE_COOKIES_ON_401_PREFIXES = [
  '/auth/refresh',
  '/api/auth/refresh',
  '/auth/login',
  '/api/auth/login',
];

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  /**
   * @param csrfCookieDomain CSRF_COOKIE_DOMAIN, so the domain-scoped
   * `csrf_token` can be deleted too. Passed in rather than injected because
   * main.ts constructs this filter by hand, outside the DI container.
   */
  constructor(private readonly csrfCookieDomain?: string) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = isHttpException ? exception.getResponse() : 'Internal server error';

    if (!isHttpException) {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    // The caller presented an access_token cookie, it was rejected, and there
    // is no refresh cookie left to recover the session with — so that cookie
    // will never authenticate anything again. Evict it now instead of letting
    // it sit in the browser for the rest of its 15-minute max-age. While it
    // lingers, CsrfGuard stops waiving the double-submit check (it only waives
    // when there is no access_token at all) and starts demanding an
    // X-CSRF-Token whose matching cookie may already be gone — which locked
    // users out of the portal entirely until they cleared cookies by hand.
    //
    // Requiring the refresh cookie to be absent is what makes this safe to do
    // from a filter that can't see the rest of the request's life. An expired
    // access token with a live refresh token is the normal state every 15
    // minutes, and a burst of requests all 401 at once when it lapses: if a
    // slow one of those landed after the refresh had already installed a fresh
    // cookie, clearing here would wipe it and log the user out for real. No
    // refresh cookie means no renewal is possible, so no such race exists.
    const recoverable = Boolean(request.cookies?.refresh_token);
    const staleAccessCookieOn401 =
      status === HttpStatus.UNAUTHORIZED &&
      Boolean(request.cookies?.access_token) &&
      !recoverable &&
      !PRESERVE_COOKIES_ON_401_PREFIXES.some((prefix) => request.path.startsWith(prefix));

    if (staleAccessCookieOn401 || this.isCsrfRejection(status, message)) {
      clearStaleAccessCookies(response, this.csrfCookieDomain);
    }

    response.status(status).json({
      statusCode: status,
      path: request.url,
      timestamp: new Date().toISOString(),
      message: typeof message === 'string' ? message : (message as Record<string, unknown>).message,
    });
  }

  /**
   * A CSRF rejection means the access half of the jar is internally
   * inconsistent — the `csrf_token` cookie is missing, expired ahead of its
   * partner, or shadowed by a duplicate the browser sends first (a host-only
   * leftover sorts ahead of the domain-scoped one, and cookie-parser keeps the
   * first). None of that resolves on its own: the client cannot obtain a
   * matching `csrf_token` without a new one being issued, so every subsequent
   * mutation 403s identically until the cookie's max-age runs out. That is the
   * "everything errors until I clear cookies" state.
   *
   * Dropping the access half breaks the loop without disturbing the session:
   * the next request 401s, the refresh cookie silently renews it, and
   * SessionService reissues `access_token` and `csrf_token` together and back
   * in sync. If the refresh token is dead too, the frontend gives up and calls
   * /auth/logout, which clears the rest. Either way the user never has to
   * touch their cookies.
   *
   * Unconditional, unlike the 401 path — that one has to sidestep a refresh
   * race (a slow 401 landing after a successful renewal would wipe the fresh
   * cookies), and a CSRF 403 cannot be produced by that race: a renewed
   * session gets a fresh cookie and a matching header on the retry.
   *
   * Matched on the message so JwtAuthGuard's other 403 — "finish setting up
   * 2FA", thrown for a perfectly healthy pending session — is left alone.
   */
  private isCsrfRejection(status: number, message: unknown): boolean {
    if (status !== HttpStatus.FORBIDDEN) {
      return false;
    }
    const text =
      typeof message === 'string' ? message : (message as Record<string, unknown> | null)?.message;
    return text === CSRF_ERROR_MESSAGE;
  }
}
