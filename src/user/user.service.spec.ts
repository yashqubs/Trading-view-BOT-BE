import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../common/enums';
import { EmailService } from '../email/email.service';
import { User } from './entities/user.entity';
import { UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;
  let repository: { findOne: jest.Mock; save: jest.Mock };
  let emailService: { sendPasswordResetEmail: jest.Mock };

  function buildUser(overrides: Partial<User> = {}): User {
    return {
      id: 'user-1',
      name: 'Test User',
      email: 'admin@example.com',
      passwordHash: 'old-hash',
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
    };
    emailService = { sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined) };

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

  describe('resetPasswordByEmail', () => {
    it('resets the password, forces a change, and emails a temp password when the account exists', async () => {
      const user = buildUser();
      repository.findOne.mockResolvedValue(user);

      await service.resetPasswordByEmail(user.email);

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ mustChangePassword: true }),
      );
      const savedUser = repository.save.mock.calls[0][0] as User;
      expect(savedUser.passwordHash).not.toBe('old-hash');
      expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        user.email,
        user.name,
        expect.any(String),
        'https://portal.test',
      );
    });

    it('does nothing when no account matches the email — no save, no email sent', async () => {
      repository.findOne.mockResolvedValue(null);

      await service.resetPasswordByEmail('nobody@example.com');

      expect(repository.save).not.toHaveBeenCalled();
      expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('does nothing for a deactivated account — same silent no-op as a non-existent one', async () => {
      repository.findOne.mockResolvedValue(buildUser({ active: false }));

      await service.resetPasswordByEmail('deactivated@example.com');

      expect(repository.save).not.toHaveBeenCalled();
      expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('never throws for a missing account — callers must not be able to distinguish this from success', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.resetPasswordByEmail('nobody@example.com')).resolves.toBeUndefined();
    });
  });
});
