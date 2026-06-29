import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_SESSION_KEY = 'allowPendingSession';

/**
 * Marks an endpoint as reachable with a "pending" session cookie — the
 * restricted token issued by POST /auth/login before 2FA verification and
 * the forced password change are complete. Every other JWT-guarded endpoint
 * rejects pending tokens by default (see JwtAuthGuard) so that knowing only
 * the password never grants access to trading/admin functionality.
 */
export const AllowPendingSession = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_PENDING_SESSION_KEY, true);
