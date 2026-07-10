import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UserRole } from '../common/enums';
import { EmailService } from '../email/email.service';
import { User } from '../user/entities/user.entity';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './session/refresh-token.service';
import { SessionService } from './session/session.service';
import { TokenBlacklistService } from './token-blacklist.service';

describe('AuthService', () => {
  let service: AuthService;
  let repository: { findOne: jest.Mock; findOneByOrFail: jest.Mock; save: jest.Mock };
  let emailService: { sendOtpEmail: jest.Mock };
  let sessionService: {
    issueAccessTokenCookie: jest.Mock;
    issueRefreshTokenCookie: jest.Mock;
    clearCookie: jest.Mock;
    establishFullSession: jest.Mock;
  };
  let refreshTokenService: { issue: jest.Mock; rotate: jest.Mock; revoke: jest.Mock };
  const mockResponse = {} as never;

  function buildUser(overrides: Partial<User> = {}): User {
    return {
      id: 'user-1',
      name: 'Test User',
      email: 'admin@example.com',
      passwordHash: '',
      tempPassword: null,
      role: UserRole.ADMIN,
      active: true,
      twoFactorEnabled: false,
      otpCodeHash: null,
      otpExpiresAt: null,
      otpPurpose: null,
      otpAttempts: 0,
      otpLastSentAt: null,
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      currentSessionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  /** Pulls the OTP code out of the mocked send call so the test can submit it back. */
  function lastSentCode(): string {
    const lastCall = emailService.sendOtpEmail.mock.calls.at(-1);
    return lastCall[1] as string;
  }

  beforeEach(async () => {
    repository = {
      findOne: jest.fn(),
      findOneByOrFail: jest.fn(),
      save: jest.fn((user) => Promise.resolve(user)),
    };
    emailService = { sendOtpEmail: jest.fn().mockResolvedValue(undefined) };
    sessionService = {
      issueAccessTokenCookie: jest.fn(),
      issueRefreshTokenCookie: jest.fn(),
      clearCookie: jest.fn(),
      establishFullSession: jest.fn().mockResolvedValue(undefined),
    };
    refreshTokenService = {
      issue: jest.fn().mockResolvedValue('mock-refresh-token'),
      rotate: jest.fn(),
      revoke: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: repository },
        JwtService,
        { provide: EmailService, useValue: emailService },
        { provide: SessionService, useValue: sessionService },
        {
          provide: TokenBlacklistService,
          useValue: { blacklist: jest.fn(), isBlacklisted: jest.fn() },
        },
        { provide: RefreshTokenService, useValue: refreshTokenService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('login (credential challenge)', () => {
    it('rejects with a generic error for a non-existent user', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'x' }, mockResponse),
      ).rejects.toThrow(UnauthorizedException);
      expect(sessionService.issueAccessTokenCookie).not.toHaveBeenCalled();
    });

    it('rejects with a generic error for a wrong password and increments the failure count', async () => {
      const user = buildUser({ passwordHash: await bcrypt.hash('correct-password', 12) });
      repository.findOne.mockResolvedValue(user);

      await expect(
        service.login({ email: user.email, password: 'wrong' }, mockResponse),
      ).rejects.toThrow(UnauthorizedException);
      expect(user.failedLoginAttempts).toBe(1);
    });

    it('locks the account after 5 failed attempts and rejects further attempts even with the correct password', async () => {
      const correctPassword = 'correct-password';
      const user = buildUser({ passwordHash: await bcrypt.hash(correctPassword, 12) });
      repository.findOne.mockResolvedValue(user);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(
          service.login({ email: user.email, password: 'wrong' }, mockResponse),
        ).rejects.toThrow(UnauthorizedException);
      }

      expect(user.lockedUntil).not.toBeNull();
      expect(user.failedLoginAttempts).toBe(0);

      await expect(
        service.login({ email: user.email, password: correctPassword }, mockResponse),
      ).rejects.toThrow('Account is temporarily locked. Try again later.');
    }, 15000);

    it('issues a pending cookie and asks for a password change before anything else', async () => {
      const user = buildUser({
        passwordHash: await bcrypt.hash('pw', 12),
        mustChangePassword: true,
      });
      repository.findOne.mockResolvedValue(user);

      const result = await service.login({ email: user.email, password: 'pw' }, mockResponse);

      expect(result).toEqual({ requiresPasswordChange: true, requires2fa: false });
      expect(sessionService.issueAccessTokenCookie).toHaveBeenCalledWith(
        user,
        mockResponse,
        true,
        '',
      );
      expect(refreshTokenService.issue).not.toHaveBeenCalled();
      expect(emailService.sendOtpEmail).not.toHaveBeenCalled();
    });

    it('emails an OTP and withholds the cookie when 2FA is enabled', async () => {
      const user = buildUser({ passwordHash: await bcrypt.hash('pw', 12), twoFactorEnabled: true });
      repository.findOne.mockResolvedValue(user);

      const result = await service.login({ email: user.email, password: 'pw' }, mockResponse);

      expect(result.requires2fa).toBe(true);
      expect(result.message).toContain('@example.com');
      expect(emailService.sendOtpEmail).toHaveBeenCalledWith(
        user.email,
        expect.any(String),
        'LOGIN',
      );
      expect(sessionService.issueAccessTokenCookie).not.toHaveBeenCalled();
    });

    it('issues a full session immediately when no password change or 2FA is pending', async () => {
      const user = buildUser({ passwordHash: await bcrypt.hash('pw', 12) });
      repository.findOne.mockResolvedValue(user);

      const result = await service.login({ email: user.email, password: 'pw' }, mockResponse);

      expect(result).toMatchObject({ requiresPasswordChange: false, requires2fa: false });
      expect(result.user?.id).toBe(user.id);
      expect(sessionService.establishFullSession).toHaveBeenCalledWith(user, mockResponse);
    });
  });

  describe('enable2fa', () => {
    it('enables 2FA directly, without any OTP confirmation', async () => {
      const user = buildUser();
      repository.findOneByOrFail.mockResolvedValue(user);

      const result = await service.enable2fa(user.id);

      expect(result.twoFactorEnabled).toBe(true);
      expect(emailService.sendOtpEmail).not.toHaveBeenCalled();
    });

    it('clears any in-flight OTP state when enabling', async () => {
      const user = buildUser({
        otpCodeHash: 'stale-hash',
        otpExpiresAt: new Date(Date.now() + 60_000),
        otpPurpose: 'LOGIN',
        otpAttempts: 2,
      });
      repository.findOneByOrFail.mockResolvedValue(user);

      await service.enable2fa(user.id);

      expect(user.otpCodeHash).toBeNull();
      expect(user.otpAttempts).toBe(0);
    });
  });

  describe('loginWith2fa', () => {
    it('issues a session cookie for a valid OTP', async () => {
      const user = buildUser({ passwordHash: await bcrypt.hash('pw', 12), twoFactorEnabled: true });
      repository.findOne.mockResolvedValue(user);
      await service.login({ email: user.email, password: 'pw' }, mockResponse);

      const result = await service.loginWith2fa(
        { email: user.email, password: 'pw', code: lastSentCode() },
        mockResponse,
      );

      expect(result.id).toBe(user.id);
      expect(sessionService.establishFullSession).toHaveBeenCalledWith(user, mockResponse);
    });

    it('rejects an invalid OTP and counts the attempt', async () => {
      const user = buildUser({ passwordHash: await bcrypt.hash('pw', 12), twoFactorEnabled: true });
      repository.findOne.mockResolvedValue(user);
      await service.login({ email: user.email, password: 'pw' }, mockResponse);

      await expect(
        service.loginWith2fa({ email: user.email, password: 'pw', code: '000000' }, mockResponse),
      ).rejects.toThrow(UnauthorizedException);
      expect(user.otpAttempts).toBe(1);
    });

    it('invalidates the OTP after 5 wrong attempts, forcing a resend', async () => {
      const user = buildUser({ passwordHash: await bcrypt.hash('pw', 12), twoFactorEnabled: true });
      repository.findOne.mockResolvedValue(user);
      await service.login({ email: user.email, password: 'pw' }, mockResponse);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(
          service.loginWith2fa({ email: user.email, password: 'pw', code: '000000' }, mockResponse),
        ).rejects.toThrow(UnauthorizedException);
      }

      expect(user.otpCodeHash).toBeNull();
    }, 15000);

    it('rejects if 2FA is not enabled for the account', async () => {
      const user = buildUser({
        passwordHash: await bcrypt.hash('pw', 12),
        twoFactorEnabled: false,
      });
      repository.findOne.mockResolvedValue(user);

      await expect(
        service.loginWith2fa({ email: user.email, password: 'pw', code: '123456' }, mockResponse),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resend cooldown', () => {
    it('rejects a resend within the cooldown window', async () => {
      const user = buildUser({ passwordHash: await bcrypt.hash('pw', 12), twoFactorEnabled: true });
      repository.findOne.mockResolvedValue(user);
      await service.login({ email: user.email, password: 'pw' }, mockResponse);

      await expect(service.resendLoginOtp({ email: user.email, password: 'pw' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('requestPasswordReset', () => {
    it('emails a RESET-purpose code when the account exists', async () => {
      const user = buildUser();
      repository.findOne.mockResolvedValue(user);

      await service.requestPasswordReset(user.email);

      expect(emailService.sendOtpEmail).toHaveBeenCalledWith(
        user.email,
        expect.any(String),
        'RESET',
      );
      expect(user.otpPurpose).toBe('RESET');
    });

    it('does nothing for a non-existent email — no email sent, never throws', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.requestPasswordReset('nobody@example.com')).resolves.toBeUndefined();
      expect(emailService.sendOtpEmail).not.toHaveBeenCalled();
    });

    it('does nothing for a deactivated account — same silent no-op as a non-existent one', async () => {
      repository.findOne.mockResolvedValue(buildUser({ active: false }));

      await expect(
        service.requestPasswordReset('deactivated@example.com'),
      ).resolves.toBeUndefined();
      expect(emailService.sendOtpEmail).not.toHaveBeenCalled();
    });

    it('swallows a resend-cooldown rejection instead of surfacing it', async () => {
      const user = buildUser({ otpLastSentAt: new Date() });
      repository.findOne.mockResolvedValue(user);

      await expect(service.requestPasswordReset(user.email)).resolves.toBeUndefined();
      expect(emailService.sendOtpEmail).not.toHaveBeenCalled();
    });
  });

  describe('resetPasswordWithCode', () => {
    it('sets the new password and clears the OTP on a valid code', async () => {
      const user = buildUser({ passwordHash: await bcrypt.hash('old-password', 12) });
      repository.findOne.mockResolvedValue(user);
      await service.requestPasswordReset(user.email);
      const code = lastSentCode();

      await service.resetPasswordWithCode({
        email: user.email,
        code,
        newPassword: 'brand-new-password',
      });

      expect(user.otpCodeHash).toBeNull();
      expect(user.mustChangePassword).toBe(false);
      expect(await bcrypt.compare('brand-new-password', user.passwordHash)).toBe(true);
    });

    it('clears any existing lockout on a successful reset', async () => {
      const user = buildUser({
        passwordHash: await bcrypt.hash('old-password', 12),
        failedLoginAttempts: 3,
        lockedUntil: new Date(Date.now() + 60_000),
      });
      repository.findOne.mockResolvedValue(user);
      await service.requestPasswordReset(user.email);
      const code = lastSentCode();

      await service.resetPasswordWithCode({
        email: user.email,
        code,
        newPassword: 'brand-new-password',
      });

      expect(user.failedLoginAttempts).toBe(0);
      expect(user.lockedUntil).toBeNull();
    });

    it('rejects a wrong code and counts the attempt', async () => {
      const user = buildUser();
      repository.findOne.mockResolvedValue(user);
      await service.requestPasswordReset(user.email);

      await expect(
        service.resetPasswordWithCode({
          email: user.email,
          code: '000000',
          newPassword: 'brand-new-password',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(user.otpAttempts).toBe(1);
    });

    it('rejects a non-existent email with the exact same error as a wrong code — no enumeration', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.resetPasswordWithCode({
          email: 'nobody@example.com',
          code: '123456',
          newPassword: 'brand-new-password',
        }),
      ).rejects.toThrow(new UnauthorizedException('Invalid or expired code'));
    });

    it('rejects a code issued for a different purpose (e.g. LOGIN)', async () => {
      const user = buildUser({ passwordHash: await bcrypt.hash('pw', 12), twoFactorEnabled: true });
      repository.findOne.mockResolvedValue(user);
      await service.login({ email: user.email, password: 'pw' }, mockResponse);
      const loginCode = lastSentCode();

      await expect(
        service.resetPasswordWithCode({
          email: user.email,
          code: loginCode,
          newPassword: 'brand-new-password',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('disable2fa', () => {
    it('disables 2FA directly, without password confirmation', async () => {
      const user = buildUser({ twoFactorEnabled: true });
      repository.findOneByOrFail.mockResolvedValue(user);

      const result = await service.disable2fa(user.id);

      expect(result.twoFactorEnabled).toBe(false);
      expect(user.otpCodeHash).toBeNull();
    });
  });

  describe('refresh', () => {
    it('rejects with no refresh cookie at all', async () => {
      await expect(service.refresh(undefined, mockResponse)).rejects.toThrow(UnauthorizedException);
      expect(refreshTokenService.rotate).not.toHaveBeenCalled();
    });

    it('rejects WITHOUT clearing cookies when the refresh token is unknown/expired', async () => {
      // Clearing here would wipe the fresh cookies a sibling tab may have
      // just installed after winning the single-use rotation race — see the
      // comment in AuthService.refresh.
      refreshTokenService.rotate.mockResolvedValue(null);

      await expect(service.refresh('stale-token', mockResponse)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(sessionService.clearCookie).not.toHaveBeenCalled();
    });

    it('rejects if the user behind a valid refresh token no longer exists or is inactive', async () => {
      refreshTokenService.rotate.mockResolvedValue({ userId: 'ghost', newToken: 'new-token' });
      repository.findOne.mockResolvedValue(null);

      await expect(service.refresh('valid-token', mockResponse)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(sessionService.clearCookie).toHaveBeenCalledWith(mockResponse);
    });

    it('issues a fresh access token and rotated refresh token for a valid refresh token', async () => {
      const user = buildUser();
      refreshTokenService.rotate.mockResolvedValue({ userId: user.id, newToken: 'rotated-token' });
      repository.findOne.mockResolvedValue(user);

      const result = await service.refresh('valid-token', mockResponse);

      expect(result.id).toBe(user.id);
      expect(sessionService.issueAccessTokenCookie).toHaveBeenCalledWith(
        user,
        mockResponse,
        false,
        '',
      );
      expect(sessionService.issueRefreshTokenCookie).toHaveBeenCalledWith(
        mockResponse,
        'rotated-token',
      );
    });
  });
});
