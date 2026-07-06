// Every session/token lifetime lives here so the numbers can't drift out of
// sync between the services that issue tokens (SessionService,
// RefreshTokenService) and anything that needs to reason about them.

// Access token: short-lived by design now that a refresh token backs silent
// renewal — see RefreshTokenService. A user who keeps making requests never
// notices this expiry; only AuthService.refresh() ever needs to know it.
export const ACCESS_TOKEN_EXPIRY = '15m';
export const ACCESS_TOKEN_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;

// Pending session: issued while a forced password change is outstanding.
// Deliberately gets no refresh token (see SessionService.issueRefreshTokenCookie),
// so this hard-expires after 15m regardless of activity.
export const PENDING_SESSION_EXPIRY = '15m';
export const PENDING_SESSION_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;

// Refresh token: opaque, hashed in the refresh_tokens table. This is the
// idle timeout — every successful RefreshTokenService.rotate() resets the
// clock, so only genuine inactivity (no requests for this long) hits it.
export const REFRESH_TOKEN_TTL_MS = 60 * 60 * 1000;
