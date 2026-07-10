import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';

const CSRF_PROTECTED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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
 * Only enforced once a session actually exists (an `access_token` cookie is
 * present) — login/2fa doesn't rely on an existing session to authorize
 * anything, so there's nothing to protect there yet, and the webhook is
 * IP/secret-guarded rather than cookie-authenticated.
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
    if (!request.cookies?.access_token) {
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
      throw new ForbiddenException('Invalid or missing CSRF token');
    }

    return true;
  }
}
