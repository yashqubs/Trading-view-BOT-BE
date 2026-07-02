import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UserRole } from '../common/enums';
import { EmailService } from '../email/email.service';
import { User } from './entities/user.entity';
import { UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;
  let repository: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };
  let emailService: { sendInviteEmail: jest.Mock; sendPasswordResetEmail: jest.Mock };

  function buildUser(overrides: Partial<User> = {}): User {
    return {
      id: 'user-1',
      name: 'Test User',
      email: 'user@example.com',
      passwordHash: 'old-hash',
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
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  beforeEach(async () => {
    repository = {
      findOne: jest.fn(),
      save: jest.fn((user) => Promise.resolve(user)),
      create: jest.fn((input) => input),
    };
    emailService = {
      sendInviteEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(User), useValue: repository },
        { provide: EmailService, useValue: emailService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('https://portal.test') },
        },
      ],
    }).compile();

    service = module.get(UserService);
  });

  describe('create', () => {
    it('stores the plaintext temp password alongside its hash and emails an invite', async () => {
      repository.findOne.mockResolvedValue(null);

      const { tempPassword } = await service.create({
        name: 'New User',
        email: 'new@example.com',
        role: UserRole.VIEWER,
      });

      const savedUser = repository.save.mock.calls[0][0] as User;
      expect(savedUser.tempPassword).toBe(tempPassword);
      expect(savedUser.mustChangePassword).toBe(true);
      expect(emailService.sendInviteEmail).toHaveBeenCalledWith(
        'new@example.com',
        'New User',
        tempPassword,
        'https://portal.test',
      );
    });
  });

  describe('resetPassword', () => {
    it('resends the exact same pending temp password instead of minting a new one', async () => {
      const user = buildUser({ mustChangePassword: true, tempPassword: 'existing-temp-pw' });
      repository.findOne.mockResolvedValue(user);

      const result = await service.resetPassword(user.id);

      expect(result.tempPassword).toBe('existing-temp-pw');
      expect(user.passwordHash).toBe('old-hash'); // untouched — no new password was minted
      expect(repository.save).not.toHaveBeenCalled();
      expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        user.email,
        user.name,
        'existing-temp-pw',
        'https://portal.test',
      );
    });

    it('repeated clicks while a reset is pending keep returning the same password', async () => {
      const user = buildUser({ mustChangePassword: true, tempPassword: 'existing-temp-pw' });
      repository.findOne.mockResolvedValue(user);

      const first = await service.resetPassword(user.id);
      const second = await service.resetPassword(user.id);

      expect(first.tempPassword).toBe(second.tempPassword);
    });

    it('mints a genuinely new temp password when none is pending (user already has their own)', async () => {
      const user = buildUser({ mustChangePassword: false, tempPassword: null });
      repository.findOne.mockResolvedValue(user);

      const result = await service.resetPassword(user.id);

      expect(result.tempPassword).toBeTruthy();
      expect(user.tempPassword).toBe(result.tempPassword);
      expect(user.mustChangePassword).toBe(true);
      expect(await bcrypt.compare(result.tempPassword, user.passwordHash)).toBe(true);
      expect(repository.save).toHaveBeenCalled();
    });

    it('mints a new temp password if mustChangePassword is true but nothing is actually stored (legacy row)', async () => {
      const user = buildUser({ mustChangePassword: true, tempPassword: null });
      repository.findOne.mockResolvedValue(user);

      const result = await service.resetPassword(user.id);

      expect(result.tempPassword).toBeTruthy();
      expect(repository.save).toHaveBeenCalled();
    });
  });

  describe('changeOwnPassword', () => {
    it('clears any pending temp password once the user sets their own', async () => {
      const user = buildUser({
        passwordHash: await bcrypt.hash('current-pw', 12),
        mustChangePassword: true,
        tempPassword: 'was-pending',
      });
      repository.findOne.mockResolvedValue(user);

      const result = await service.changeOwnPassword(user.id, {
        currentPassword: 'current-pw',
        newPassword: 'brand-new-password',
      });

      expect(result.tempPassword).toBeNull();
      expect(result.mustChangePassword).toBe(false);
    });

    it('rejects an incorrect current password', async () => {
      const user = buildUser({ passwordHash: await bcrypt.hash('current-pw', 12) });
      repository.findOne.mockResolvedValue(user);

      await expect(
        service.changeOwnPassword(user.id, {
          currentPassword: 'wrong',
          newPassword: 'brand-new-password',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
