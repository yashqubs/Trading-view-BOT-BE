import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

// @otplib/v12-adapter pulls in a transitive ESM-only crypto dependency chain
// (@scure/base, @noble/hashes) that Jest's CJS module resolver cannot load
// even though plain Node `require()` (i.e. the real running app) resolves it
// fine via the package's bundled dist/index.cjs. Mocking it here keeps the
// unit test isolated from that tooling gap and from real TOTP timing.
jest.mock('@otplib/v12-adapter', () => ({
  authenticator: {
    generateSecret: () => 'FIXED-TEST-SECRET',
    generate: (secret: string) => `CODE-${secret}`,
    check: (token: string, secret: string) => token === `CODE-${secret}`,
    keyuri: (email: string, issuer: string, secret: string) =>
      `otpauth://totp/${issuer}:${email}?secret=${secret}`,
  },
}));

import { authenticator } from '@otplib/v12-adapter';
import { UserRole } from '../common/enums';
import { SecretsService } from '../secrets/secrets.service';
import { User } from '../user/entities/user.entity';
import { AuthService } from './auth.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { encrypt } from './utils/encryption.util';
import { generateRecoveryCodes } from './utils/recovery-codes.util';

const ENCRYPTION_KEY = 'test-totp-encryption-key';

describe('AuthService', () => {
  let service: AuthService;
  let repository: { findOne: jest.Mock; findOneByOrFail: jest.Mock; save: jest.Mock };
  let mockResponse: { cookie: jest.Mock; clearCookie: jest.Mock };

  function buildUser(overrides: Partial<User> = {}): User {
    return {
      id: 'user-1',
      name: 'Test User',
      email: 'admin@example.com',
      passwordHash: '',
      role: UserRole.ADMIN,
      active: true,
      totpSecret: null,
      totpEnabled: false,
      recoveryCodes: null,
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  beforeEach(async () => {
    repository = {
      findOne: jest.fn(),
      findOneByOrFail: jest.fn(),
      save: jest.fn((user) => Promise.resolve(user)),
    };
    mockResponse = { cookie: jest.fn(), clearCookie: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: repository },
        JwtService,
        {
          provide: SecretsService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'JWT_SECRET') return 'test-jwt-secret';
              if (key === 'TOTP_ENCRYPTION_KEY') return ENCRYPTION_KEY;
              throw new Error(`Unexpected secret requested: ${key}`);
            }),
          },
        },
        {
          provide: TokenBlacklistService,
          useValue: { blacklist: jest.fn(), isBlacklisted: jest.fn() },
        },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('test') } },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('login (credential challenge)', () => {
    it('rejects with a generic error for a non-existent user', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'x' }, mockResponse as never),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockResponse.cookie).not.toHaveBeenCalled();
    });

    it('rejects with a generic error for a wrong password and increments the failure count', async () => {
      const user = buildUser({ passwordHash: await bcrypt.hash('correct-password', 12) });
      repository.findOne.mockResolvedValue(user);

      await expect(
        service.login({ email: user.email, password: 'wrong' }, mockResponse as never),
      ).rejects.toThrow(UnauthorizedException);
      expect(user.failedLoginAttempts).toBe(1);
    });

    it('locks the account after 5 failed attempts and rejects further attempts even with the correct password', async () => {
      const correctPassword = 'correct-password';
      const user = buildUser({ passwordHash: await bcrypt.hash(correctPassword, 12) });
      repository.findOne.mockResolvedValue(user);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(
          service.login({ email: user.email, password: 'wrong' }, mockResponse as never),
        ).rejects.toThrow(UnauthorizedException);
      }

      expect(user.lockedUntil).not.toBeNull();
      expect(user.failedLoginAttempts).toBe(0); // reset when the lock is applied

      await expect(
        service.login({ email: user.email, password: correctPassword }, mockResponse as never),
      ).rejects.toThrow('Account is temporarily locked. Try again later.');
    });

    it('returns requiresSetup2fa and issues a pending cookie when 2FA has not been configured yet', async () => {
      const user = buildUser({ passwordHash: await bcrypt.hash('pw', 12), totpEnabled: false });
      repository.findOne.mockResolvedValue(user);

      const result = await service.login(
        { email: user.email, password: 'pw' },
        mockResponse as never,
      );

      expect(result).toEqual({ requiresSetup2fa: true, requires2fa: false });
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'access_token',
        expect.any(String),
        expect.any(Object),
      );
    });

    it('returns requires2fa when 2FA is already enabled', async () => {
      const user = buildUser({ passwordHash: await bcrypt.hash('pw', 12), totpEnabled: true });
      repository.findOne.mockResolvedValue(user);

      const result = await service.login(
        { email: user.email, password: 'pw' },
        mockResponse as never,
      );

      expect(result.requires2fa).toBe(true);
      expect(result.requiresSetup2fa).toBe(false);
    });
  });

  describe('setup2fa', () => {
    it('generates and stores an encrypted secret + recovery codes', async () => {
      const user = buildUser({ totpEnabled: false });
      repository.findOneByOrFail.mockResolvedValue(user);

      const result = await service.setup2fa(user.id);

      expect(result.recoveryCodes).toHaveLength(10);
      expect(result.qrCodeUri).toMatch(/^data:image\/png;base64,/);
      expect(user.totpSecret).not.toBeNull();
      expect(user.totpEnabled).toBe(false); // not enabled until verify2faSetup succeeds
    });

    it('rejects if 2FA is already enabled', async () => {
      const user = buildUser({ totpEnabled: true });
      repository.findOneByOrFail.mockResolvedValue(user);

      await expect(service.setup2fa(user.id)).rejects.toThrow(BadRequestException);
    });
  });

  describe('verify2faSetup', () => {
    it('rejects if setup was never started', async () => {
      const user = buildUser({ totpSecret: null });
      repository.findOneByOrFail.mockResolvedValue(user);

      await expect(
        service.verify2faSetup(user.id, { code: '123456' }, mockResponse as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('enables 2FA and issues a full (non-pending) cookie on a valid code', async () => {
      const secret = authenticator.generateSecret();
      const user = buildUser({ totpSecret: encrypt(secret, ENCRYPTION_KEY) });
      repository.findOneByOrFail.mockResolvedValue(user);

      const code = authenticator.generate(secret);
      const result = await service.verify2faSetup(user.id, { code }, mockResponse as never);

      expect(result.totpEnabled).toBe(true);
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'access_token',
        expect.any(String),
        expect.any(Object),
      );
    });

    it('rejects an invalid code', async () => {
      const secret = authenticator.generateSecret();
      const user = buildUser({ totpSecret: encrypt(secret, ENCRYPTION_KEY) });
      repository.findOneByOrFail.mockResolvedValue(user);

      await expect(
        service.verify2faSetup(user.id, { code: '000000' }, mockResponse as never),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('loginWith2fa', () => {
    it('issues a session cookie for a valid TOTP code', async () => {
      const secret = authenticator.generateSecret();
      const user = buildUser({
        passwordHash: await bcrypt.hash('pw', 12),
        totpEnabled: true,
        totpSecret: encrypt(secret, ENCRYPTION_KEY),
      });
      repository.findOne.mockResolvedValue(user);

      const code = authenticator.generate(secret);
      const result = await service.loginWith2fa(
        { email: user.email, password: 'pw', code },
        mockResponse as never,
      );

      expect(result.id).toBe(user.id);
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'access_token',
        expect.any(String),
        expect.any(Object),
      );
    });

    it('rejects an invalid TOTP code', async () => {
      const secret = authenticator.generateSecret();
      const user = buildUser({
        passwordHash: await bcrypt.hash('pw', 12),
        totpEnabled: true,
        totpSecret: encrypt(secret, ENCRYPTION_KEY),
      });
      repository.findOne.mockResolvedValue(user);

      await expect(
        service.loginWith2fa(
          { email: user.email, password: 'pw', code: '000000' },
          mockResponse as never,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('accepts a single-use recovery code and consumes it', async () => {
      const secret = authenticator.generateSecret();
      const recoveryCodes = generateRecoveryCodes();
      const user = buildUser({
        passwordHash: await bcrypt.hash('pw', 12),
        totpEnabled: true,
        totpSecret: encrypt(secret, ENCRYPTION_KEY),
        recoveryCodes: encrypt(JSON.stringify(recoveryCodes), ENCRYPTION_KEY),
      });
      repository.findOne.mockResolvedValue(user);

      const usedCode = recoveryCodes[0];
      await service.loginWith2fa(
        { email: user.email, password: 'pw', code: usedCode },
        mockResponse as never,
      );

      // Re-using the same recovery code must fail second time.
      await expect(
        service.loginWith2fa(
          { email: user.email, password: 'pw', code: usedCode },
          mockResponse as never,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
