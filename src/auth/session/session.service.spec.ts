import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SecretsService } from '../../secrets/secrets.service';
import { User } from '../../user/entities/user.entity';
import { RefreshTokenService } from './refresh-token.service';
import { SessionService } from './session.service';

describe('SessionService', () => {
  let service: SessionService;
  let response: { cookie: jest.Mock; clearCookie: jest.Mock };
  let config: Record<string, string | undefined>;

  const user = {
    id: 'user-1',
    email: 'admin@example.com',
  } as User;

  function issuedCookie(name: string): { value: string; options: Record<string, unknown> } {
    const call = response.cookie.mock.calls.find(([cookieName]) => cookieName === name);
    expect(call).toBeDefined();
    return { value: call![1] as string, options: call![2] as Record<string, unknown> };
  }

  beforeEach(async () => {
    config = { NODE_ENV: 'test' };
    response = { cookie: jest.fn(), clearCookie: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('signed-jwt') } },
        { provide: SecretsService, useValue: { get: jest.fn().mockReturnValue('jwt-secret') } },
        { provide: ConfigService, useValue: { get: jest.fn((key: string) => config[key]) } },
        {
          provide: RefreshTokenService,
          useValue: {
            issue: jest.fn().mockResolvedValue('refresh-token'),
            revokeAllForUser: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: { save: jest.fn((entity) => Promise.resolve(entity)) },
        },
      ],
    }).compile();

    service = module.get(SessionService);
  });

  describe('csrf_token cookie domain (CSRF_COOKIE_DOMAIN)', () => {
    it('issues a host-only csrf_token when CSRF_COOKIE_DOMAIN is unset', () => {
      service.issueAccessTokenCookie(user, response as never, false, 'session-1');

      const csrf = issuedCookie('csrf_token');
      expect(csrf.options).not.toHaveProperty('domain');
      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('scopes csrf_token to the configured domain and clears the host-only variant first', () => {
      config.CSRF_COOKIE_DOMAIN = '.qubs.co.uk';

      service.issueAccessTokenCookie(user, response as never, false, 'session-1');

      const csrf = issuedCookie('csrf_token');
      expect(csrf.options.domain).toBe('.qubs.co.uk');
      // A leftover host-only csrf_token is a different cookie to the browser;
      // both would be sent and the double-submit match becomes a coin toss.
      expect(response.clearCookie).toHaveBeenCalledWith('csrf_token');
    });

    it('keeps access_token host-only even when CSRF_COOKIE_DOMAIN is set', () => {
      config.CSRF_COOKIE_DOMAIN = '.qubs.co.uk';

      service.issueAccessTokenCookie(user, response as never, false, 'session-1');

      const accessToken = issuedCookie('access_token');
      expect(accessToken.options).not.toHaveProperty('domain');
      expect(accessToken.options.httpOnly).toBe(true);
    });
  });

  describe('clearCookie', () => {
    it('clears only host-only cookies when CSRF_COOKIE_DOMAIN is unset', () => {
      service.clearCookie(response as never);

      expect(response.clearCookie).toHaveBeenCalledWith('access_token');
      expect(response.clearCookie).toHaveBeenCalledWith('csrf_token');
      expect(response.clearCookie).toHaveBeenCalledWith('refresh_token');
      expect(response.clearCookie).not.toHaveBeenCalledWith('csrf_token', expect.anything());
    });

    it('clears both csrf_token variants when CSRF_COOKIE_DOMAIN is set', () => {
      config.CSRF_COOKIE_DOMAIN = '.qubs.co.uk';

      service.clearCookie(response as never);

      expect(response.clearCookie).toHaveBeenCalledWith('csrf_token');
      expect(response.clearCookie).toHaveBeenCalledWith('csrf_token', { domain: '.qubs.co.uk' });
    });
  });
});
