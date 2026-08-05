/**
 * Decides whether an `access_token` cookie still represents a *live session*,
 * without verifying its signature.
 *
 * This exists for CsrfGuard, which runs as a global guard — i.e. ahead of every
 * route's JwtAuthGuard — and so has to answer "is there any authority here for
 * a CSRF attack to ride on?" before anything has authenticated the request.
 * "There is an access_token cookie" is the wrong answer to that question: a
 * cookie that expired, or was issued against a session that has since been
 * replaced, carries no authority at all, yet its mere presence used to make the
 * guard demand an X-CSRF-Token and reject the request with 403. That 403 then
 * short-circuited the whole request, so the 401-triggered stale-cookie cleanup
 * in GlobalExceptionFilter never ran, and the jar stayed poisoned until the
 * user cleared cookies by hand.
 *
 * Signature verification is deliberately NOT done here:
 *
 *  - It isn't needed for safety. Waiving CSRF only ever happens for a token
 *    this says is dead, and a request carrying a dead token is guaranteed to be
 *    rejected by JwtAuthGuard (which does verify properly) on every
 *    state-changing route — every one of them is either JWT-guarded or already
 *    CSRF-exempt. So nothing is reachable with the check waived that wasn't
 *    already going to 401.
 *  - Getting it wrong fails in the safe direction. A forged token with a
 *    far-future `exp` reads as "live" here, which *enables* the CSRF check
 *    rather than skipping it.
 *  - It keeps this a pure function with no secret and no DI, so the guard stays
 *    synchronous and cheap on the hot path.
 */
export function isLiveSessionToken(token: unknown): boolean {
  if (typeof token !== 'string' || token.length === 0) {
    return false;
  }

  const segments = token.split('.');
  if (segments.length !== 3) {
    return false;
  }

  try {
    const payload: unknown = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));

    if (typeof payload !== 'object' || payload === null) {
      return false;
    }

    // Every token this app issues is signed with an `expiresIn`, so it always
    // carries a numeric `exp`. Anything without one did not come from here and
    // is treated as dead — JwtStrategy would reject it anyway.
    const exp = (payload as { exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) && exp * 1000 > Date.now();
  } catch {
    return false;
  }
}
