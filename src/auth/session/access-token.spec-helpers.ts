// Test-only fixtures, shared by access-token.util.spec.ts and csrf.guard.spec.ts.
// Kept out of a .spec.ts file so importing them doesn't drag another suite in.

/** Builds a structurally real JWT — only the payload is ever inspected. */
export function buildJwt(payload: Record<string, unknown>): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

export const LIVE_JWT = buildJwt({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + 900 });
export const EXPIRED_JWT = buildJwt({ sub: 'u1', exp: Math.floor(Date.now() / 1000) - 60 });
