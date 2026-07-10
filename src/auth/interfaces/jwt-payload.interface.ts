export interface JwtPayload {
  sub: string;
  email: string;
  /** True for the restricted session issued while the user still has a forced password change pending. */
  pending: boolean;
  /**
   * Must match the user's `currentSessionId` in the database for non-pending
   * sessions — see JwtStrategy.validate. Enforces single-active-session: a
   * fresh login overwrites this on the user row, so the previous device's
   * access token stops validating on its very next request.
   */
  sessionId: string;
}
