import { buildJwt, EXPIRED_JWT, LIVE_JWT } from './access-token.spec-helpers';
import { isLiveSessionToken } from './access-token.util';

describe('isLiveSessionToken', () => {
  it('accepts a token whose exp is still in the future', () => {
    expect(isLiveSessionToken(LIVE_JWT)).toBe(true);
  });

  it('rejects an expired token', () => {
    // The whole point: an expired access_token cookie is not a session, so
    // CsrfGuard must not treat it as one and start demanding a header.
    expect(isLiveSessionToken(EXPIRED_JWT)).toBe(false);
  });

  it('rejects a token that expires exactly now', () => {
    expect(isLiveSessionToken(buildJwt({ exp: Math.floor(Date.now() / 1000) - 1 }))).toBe(false);
  });

  it('rejects a token carrying no exp claim', () => {
    expect(isLiveSessionToken(buildJwt({ sub: 'u1' }))).toBe(false);
  });

  it('rejects a non-numeric exp', () => {
    expect(isLiveSessionToken(buildJwt({ exp: '9999999999' }))).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['empty string', ''],
    ['not a jwt', 'garbage'],
    ['too few segments', 'a.b'],
    ['undecodable payload', 'a.!!!not-base64!!!.c'],
    ['payload that is not JSON', `a.${Buffer.from('nope').toString('base64url')}.c`],
    ['payload that is a JSON array', `a.${Buffer.from('[1,2]').toString('base64url')}.c`],
    ['payload that is JSON null', `a.${Buffer.from('null').toString('base64url')}.c`],
  ])('rejects %s without throwing', (_label, value) => {
    expect(isLiveSessionToken(value)).toBe(false);
  });
});
