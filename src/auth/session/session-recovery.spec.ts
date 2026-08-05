import {
  CanActivate,
  Controller,
  ExecutionContext,
  INestApplication,
  Injectable,
  Patch,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { GlobalExceptionFilter } from '../../common/filters/http-exception.filter';
import { EXPIRED_JWT, LIVE_JWT } from './access-token.spec-helpers';

/**
 * End-to-end cover, over real HTTP, for the lockout that kept coming back:
 * "came back after a while, login errored, only clearing cookies fixed it".
 *
 * Unit tests missed it because it is an *interaction*, not a bug in any one
 * unit. CsrfGuard is a global guard, so it runs ahead of every route's
 * JwtAuthGuard; a stale cookie jar therefore produced a 403 from the guard
 * rather than the 401 from authentication that GlobalExceptionFilter watches
 * for. Each piece behaved exactly as its own tests said it should, and the
 * self-healing path was still unreachable from the one state it existed to fix.
 *
 * So this wires the guard, the filter and cookie-parser together the way
 * main.ts does and asserts on the response headers a browser would actually
 * act on. Every case below was first reproduced against the live API.
 */

const CSRF_DOMAIN = '.qubs.co.uk';

/**
 * Stands in for JwtAuthGuard: authenticates only a live token, so this suite
 * needs no JWT secret, database or passport wiring. What matters here is that
 * a rejected request produces a 401 at this stage.
 */
@Injectable()
class FakeJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ cookies?: Record<string, string> }>();
    if (request.cookies?.access_token !== LIVE_JWT) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

@Controller()
class ProtectedController {
  // Stands in for any real mutating route. All of them are JwtAuthGuard'd, so
  // an unauthenticated request must end in 401 — the point being that it has to
  // *get there* rather than being turned away by CsrfGuard first.
  @Patch('rules')
  @UseGuards(FakeJwtAuthGuard)
  update(): { ok: boolean } {
    return { ok: true };
  }
}

/** Names the response asks the browser to delete (max-age in the past). */
function deletedCookies(headers: Record<string, unknown>): string[] {
  const raw = (headers['set-cookie'] ?? []) as string[];
  return raw
    .filter((cookie) => /Expires=Thu, 01 Jan 1970/.test(cookie))
    .map((cookie) => cookie.split('=')[0]);
}

describe('session recovery over HTTP', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProtectedController],
      providers: [{ provide: APP_GUARD, useClass: CsrfGuard }],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new GlobalExceptionFilter(CSRF_DOMAIN));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('a jar left over from a lapsed session', () => {
    it('reaches authentication instead of being turned away by CsrfGuard', async () => {
      // The regression itself. This used to answer 403 — which short-circuits
      // the request, so the filter's cleanup never ran and the jar stayed
      // poisoned for the life of the cookie.
      const response = await request(app.getHttpServer())
        .patch('/api/rules')
        .set('Cookie', [`access_token=${EXPIRED_JWT}`, 'csrf_token=leftover'])
        .send({});

      expect(response.status).toBe(401);
    });

    it('evicts the dead cookies so the next attempt starts clean', async () => {
      const response = await request(app.getHttpServer())
        .patch('/api/rules')
        .set('Cookie', [`access_token=${EXPIRED_JWT}`, 'csrf_token=leftover'])
        .send({});

      expect(deletedCookies(response.headers)).toEqual([
        'access_token',
        'csrf_token',
        'csrf_token',
      ]);
    });

    it('still recovers when a duplicate csrf cookie shadows the real one', async () => {
      // cookie-parser keeps the first of two same-named cookies, and a browser
      // sends the host-only leftover ahead of the domain-scoped one — so the
      // value checked server-side can never match the header the frontend read
      // from document.cookie. Permanently unfixable from the client.
      const response = await request(app.getHttpServer())
        .patch('/api/rules')
        .set('Cookie', [
          `access_token=${EXPIRED_JWT}`,
          'csrf_token=stale-host-only',
          'csrf_token=fresh-domain-scoped',
        ])
        .set('X-CSRF-Token', 'fresh-domain-scoped')
        .send({});

      expect(response.status).toBe(401);
      expect(deletedCookies(response.headers)).toContain('access_token');
    });

    it('recovers even while a dead refresh_token is still in the jar', async () => {
      // The filter treats a refresh cookie as "this session is still
      // recoverable" and so declines to evict the access cookie next to it.
      // That is correct for the ordinary 15-minute lapse, but a refresh token
      // that is dead server-side is indistinguishable from here — and the
      // refresh endpoint deliberately never clears it either, to protect the
      // rotation race. Nothing on the server ends that state, so the response
      // must at least stay a 401: that is what drives the frontend through
      // refresh, failure, and on to POST /auth/logout, which does clear it.
      const response = await request(app.getHttpServer())
        .patch('/api/rules')
        .set('Cookie', [
          `access_token=${EXPIRED_JWT}`,
          'refresh_token=revoked',
          'csrf_token=leftover',
        ])
        .send({});

      expect(response.status).toBe(401);
    });
  });

  describe('a live session', () => {
    it('still enforces the double-submit check', async () => {
      const response = await request(app.getHttpServer())
        .patch('/api/rules')
        .set('Cookie', [`access_token=${LIVE_JWT}`, 'csrf_token=abc'])
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.message).toBe('Invalid or missing CSRF token');
    });

    it('passes a matching cookie/header pair through untouched', async () => {
      const response = await request(app.getHttpServer())
        .patch('/api/rules')
        .set('Cookie', [`access_token=${LIVE_JWT}`, 'csrf_token=abc'])
        .set('X-CSRF-Token', 'abc')
        .send({});

      expect(response.status).toBe(200);
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('breaks a CSRF deadlock by dropping the access half', async () => {
      // A live session whose csrf cookie no longer matches the header cannot
      // repair itself: the client can neither read the httpOnly half of the jar
      // nor mint a replacement, so every mutation 403s identically until the
      // cookie expires. Dropping the access half turns the next request into a
      // 401 the refresh cookie renews silently, reissuing both cookies in sync.
      const response = await request(app.getHttpServer())
        .patch('/api/rules')
        .set('Cookie', [`access_token=${LIVE_JWT}`, 'csrf_token=abc', 'refresh_token=live'])
        .set('X-CSRF-Token', 'stale')
        .send({});

      expect(response.status).toBe(403);
      expect(deletedCookies(response.headers)).toEqual([
        'access_token',
        'csrf_token',
        'csrf_token',
      ]);
    });
  });
});
