import { Response } from 'express';

// Cookie names and the clearing rules live here rather than only on
// SessionService because GlobalExceptionFilter also has to clear them, and it
// is constructed by hand in main.ts (no DI container to inject a service from).
// Two places writing the same cookie names by hand is how they drift apart.

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const CSRF_TOKEN_COOKIE = 'csrf_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/**
 * Both variants: host-only (local dev / pre-CSRF_COOKIE_DOMAIN sessions) and
 * domain-scoped. Deletion only matches a cookie whose domain matches, so
 * clearing one leaves the other behind — and the browser would then keep
 * sending the survivor. Worse, it sends *both* when both exist, host-only
 * first (equal path length, older creation time), and cookie-parser keeps the
 * first — so a leftover shadows the live one and every mutation 403s.
 */
function clearBothVariants(response: Response, name: string, cookieDomain?: string): void {
  response.clearCookie(name);
  if (cookieDomain) {
    response.clearCookie(name, { domain: cookieDomain });
  }
}

/**
 * Clears the *access* half of the session only — deliberately NOT the refresh
 * token.
 *
 * Used when a request presented an `access_token` cookie and it was rejected.
 * An expired access token is the normal, expected state every 15 minutes and
 * the refresh cookie is exactly what recovers from it, so wiping the refresh
 * token here would kill silent renewal outright.
 *
 * Clearing the dead access token matters because its mere presence changes
 * behaviour: CsrfGuard only waives the double-submit check when there's no
 * `access_token` cookie at all, so a corpse cookie left in the jar makes the
 * guard demand an `X-CSRF-Token` the login page can't always produce, and the
 * user is locked out until they clear cookies by hand.
 */
export function clearStaleAccessCookies(response: Response, csrfCookieDomain?: string): void {
  response.clearCookie(ACCESS_TOKEN_COOKIE);
  clearBothVariants(response, CSRF_TOKEN_COOKIE, csrfCookieDomain);
}

/**
 * Full teardown: logout, or a refresh attempt with no refresh cookie at all.
 *
 * This is the last-resort escape hatch — `POST /auth/logout` needs no session,
 * no CSRF header, and always returns 200, so it is what the frontend falls back
 * to once it has exhausted silent recovery. It therefore has to leave the jar
 * genuinely empty, not almost empty: the domain-scoped variants are cleared for
 * `access_token` and `refresh_token` too. Neither is issued with a domain
 * today, but a single leftover from any past or future config change is enough
 * to shadow the real cookie for the rest of its max-age, and that is exactly
 * the failure this hatch exists to end.
 */
export function clearAllSessionCookies(response: Response, csrfCookieDomain?: string): void {
  clearBothVariants(response, ACCESS_TOKEN_COOKIE, csrfCookieDomain);
  clearBothVariants(response, CSRF_TOKEN_COOKIE, csrfCookieDomain);
  clearBothVariants(response, REFRESH_TOKEN_COOKIE, csrfCookieDomain);
}
