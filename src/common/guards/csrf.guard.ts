import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { isLiveSessionToken } from '../../auth/session/access-token.util';

const CSRF_PROTECTED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Exported so GlobalExceptionFilter can tell a CSRF rejection apart from the
 * other 403 this app throws (JwtAuthGuard's "finish setting up 2FA"), which
 * comes from a perfectly healthy session and must not trigger any cleanup.
 */
export const CSRF_ERROR_MESSAGE = 'Invalid or missing CSRF token';

// Exempt routes authorize by something other than the session cookie — the
// webhook by IP whitelist + shared secret, the auth routes by credentials,
// OTP code, or the opaque refresh token. None of them exercise any authority
// a CSRF attack could ride on, and enforcing here can lock a user out of
// logging in entirely: a stale access_token cookie left over from an expired
// session makes the guard demand a csrf header the login page can't always
// produce. Listed with and without the global 'api' prefix because
// request.path includes it at runtime but not in unit tests.
const CSRF_EXEMPT_PATH_PREFIXES = [
  '/webhook',
  '/api/webhook',
  '/auth/login',
  '/api/auth/login',
  '/auth/forgot-password',
  '/api/auth/forgot-password',
  '/auth/reset-password',
  '/api/auth/reset-password',
  '/auth/refresh',
  '/api/auth/refresh',
  // Logout must stay reachable with a broken or half-expired cookie jar —
  // it's the server-side way to clean one up. A forged cross-site logout is a
  // nuisance at worst (SameSite=Strict already blocks it), and refusing it is
  // what left users stuck clearing cookies manually.
  '/auth/logout',
  '/api/auth/logout',
];

/**
 * Double-submit CSRF check: the non-httpOnly `csrf_token` cookie (readable by
 * frontend JS, unlike `access_token`) must match the `X-CSRF-Token` header on
 * every state-changing request. A cross-site attacker's page can trigger a
 * request that automatically carries the victim's cookies, but can't read
 * the cookie's value itself to also set a matching header.
 *
 * Defense-in-depth on top of the existing SameSite=Strict cookie, which
 * already blocks this in modern browsers.
 *
 * Only enforced once a session actually exists — login/2fa doesn't rely on an
 * existing session to authorize anything, so there's nothing to protect there
 * yet, and the webhook is IP/secret-guarded rather than cookie-authenticated.
 *
 * "A session exists" means a *live* access token, not merely an `access_token`
 * cookie sitting in the jar (see isLiveSessionToken). Treating any leftover
 * cookie as a session is what locked users out: an expired token made this
 * guard demand an X-CSRF-Token, the 403 short-circuited the request before
 * JwtAuthGuard could turn it into the 401 that GlobalExceptionFilter uses to
 * evict stale cookies, and the jar could then never heal itself — clearing
 * cookies by hand was the only way back in.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (!CSRF_PROTECTED_METHODS.has(request.method)) {
      return true;
    }
    if (CSRF_EXEMPT_PATH_PREFIXES.some((prefix) => request.path.startsWith(prefix))) {
      return true;
    }
    if (!isLiveSessionToken(request.cookies?.access_token)) {
      return true;
    }

    const cookieToken = request.cookies?.csrf_token;
    const headerToken = request.headers['x-csrf-token'];

    if (
      typeof cookieToken !== 'string' ||
      typeof headerToken !== 'string' ||
      cookieToken.length === 0 ||
      cookieToken !== headerToken
    ) {
      throw new ForbiddenException(CSRF_ERROR_MESSAGE);
    }

    return true;
  }
}
