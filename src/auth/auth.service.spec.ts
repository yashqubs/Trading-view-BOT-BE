import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UserRole } from '../common/enums';
import { EmailService } from '../email/email.service';
import { User } from '../user/entities/user.entity';
import { AuthService } from './auth.service';
import { SessionService } from './session/session.service';
import { TokenBlacklistService } from './token-blacklist.service';

describe('AuthService', () => {
  let service: AuthService;
  let repository: { findOne: jest.Mock; findOneByOrFail: jest.Mock; save: jest.Mock };
  let emailService: { sendOtpEmail: jest.Mock };
  let sessionService: { issueCookie: jest.Mock; clearCookie: jest.Mock };
  const mockResponse = {} as never;

  function buildUser(overrides: Partial<User> = {}): User {
    return {
      id: 'user-1',
      name: 'Test User',
      email: 'admin@example.com',
      passwordHash: '',
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
    sessionService = { issueCookie: jest.fn(), clearCookie: jest.fn() };

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
      expect(sessionService.issueCookie).not.toHaveBeenCalled();
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
      expect(sessionService.issueCookie).toHaveBeenCalledWith(user, mockResponse, true);
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
      expect(sessionService.issueCookie).not.toHaveBeenCalled();
    });

    it('issues a full session immediately when no password change or 2FA is pending', async () => {
      const user = buildUser({ passwordHash: await bcrypt.hash('pw', 12) });
      repository.findOne.mockResolvedValue(user);

      const result = await service.login({ email: user.email, password: 'pw' }, mockResponse);

      expect(result).toMatchObject({ requiresPasswordChange: false, requires2fa: false });
      expect(result.user?.id).toBe(user.id);
      expect(sessionService.issueCookie).toHaveBeenCalledWith(user, mockResponse, false);
    });
  });

  describe('setup2fa / verify2faSetup', () => {
    it('emails a setup OTP', async () => {
      const user = buildUser();
      repository.findOneByOrFail.mockResolvedValue(user);

      const result = await service.setup2fa(user.id);

      expect(result.maskedEmail).toContain('@example.com');
      expect(emailService.sendOtpEmail).toHaveBeenCalledWith(
        user.email,
        expect.any(String),
        'SETUP',
      );
      expect(user.twoFactorEnabled).toBe(false);
    });

    it('rejects if 2FA is already enabled', async () => {
      const user = buildUser({ twoFactorEnabled: true });
      repository.findOneByOrFail.mockResolvedValue(user);

      await expect(service.setup2fa(user.id)).rejects.toThrow(BadRequestException);
    });

    it('enables 2FA on a valid code', async () => {
      const user = buildUser();
      repository.findOneByOrFail.mockResolvedValue(user);
      await service.setup2fa(user.id);

      const result = await service.verify2faSetup(user.id, { code: lastSentCode() });

      expect(result.twoFactorEnabled).toBe(true);
      expect(user.otpCodeHash).toBeNull();
    });

    it('rejects an invalid code', async () => {
      const user = buildUser();
      repository.findOneByOrFail.mockResolvedValue(user);
      await service.setup2fa(user.id);

      await expect(service.verify2faSetup(user.id, { code: '000000' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an expired code', async () => {
      const user = buildUser();
      repository.findOneByOrFail.mockResolvedValue(user);
      await service.setup2fa(user.id);
      user.otpExpiresAt = new Date(Date.now() - 1000);

      await expect(service.verify2faSetup(user.id, { code: lastSentCode() })).rejects.toThrow(
        UnauthorizedException,
      );
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
      expect(sessionService.issueCookie).toHaveBeenCalledWith(user, mockResponse, false);
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
      const user = buildUser();
      repository.findOneByOrFail.mockResolvedValue(user);
      await service.setup2fa(user.id);

      await expect(service.resendSetupOtp(user.id)).rejects.toThrow(BadRequestException);
    });
  });

  describe('disable2fa', () => {
    it('disables 2FA when the password is correct', async () => {
      const user = buildUser({ passwordHash: await bcrypt.hash('pw', 12), twoFactorEnabled: true });
      repository.findOneByOrFail.mockResolvedValue(user);

      const result = await service.disable2fa(user.id, { password: 'pw' });

      expect(result.twoFactorEnabled).toBe(false);
    });

    it('rejects an incorrect password', async () => {
      const user = buildUser({ passwordHash: await bcrypt.hash('pw', 12), twoFactorEnabled: true });
      repository.findOneByOrFail.mockResolvedValue(user);

      await expect(service.disable2fa(user.id, { password: 'wrong' })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
