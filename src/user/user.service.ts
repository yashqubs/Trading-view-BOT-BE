import { randomBytes } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { EmailService } from '../email/email.service';
import { UserRole } from '../common/enums';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';

const BCRYPT_COST = 12;

export interface CreatedUserResult {
  user: User;
  tempPassword: string;
}

export interface ResetPasswordResult {
  user: User;
  tempPassword: string;
}

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  findAll(): Promise<User[]> {
    return this.userRepository.find({ order: { createdAt: 'ASC' } });
  }

  async findByIdOrThrow(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async create(dto: CreateUserDto): Promise<CreatedUserResult> {
    const existing = await this.userRepository.findOne({ where: { email: dto.email } });
    if (existing) {
      throw new BadRequestException('A user with this email already exists');
    }

    const tempPassword = this.generateTempPassword();
    const user = this.userRepository.create({
      name: dto.name,
      email: dto.email,
      role: dto.role,
      passwordHash: await bcrypt.hash(tempPassword, BCRYPT_COST),
      mustChangePassword: true,
      twoFactorEnabled: false,
      active: true,
    });

    const saved = await this.userRepository.save(user);
    await this.emailService.sendInviteEmail(
      saved.email,
      saved.name,
      tempPassword,
      this.portalUrl(),
    );
    return { user: saved, tempPassword };
  }

  async update(id: string, dto: UpdateUserDto, currentUserId: string): Promise<User> {
    const user = await this.findByIdOrThrow(id);

    if (dto.active === false && id === currentUserId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }

    const isDemotingFromAdmin = user.role === UserRole.ADMIN && dto.role === UserRole.VIEWER;
    const isDeactivatingAdmin = user.role === UserRole.ADMIN && dto.active === false;
    if ((isDemotingFromAdmin && id === currentUserId) || isDeactivatingAdmin) {
      if (isDemotingFromAdmin && id === currentUserId) {
        throw new BadRequestException('You cannot remove your own admin role');
      }
      await this.assertAnotherActiveAdminExists(id);
    }

    if (dto.name !== undefined) user.name = dto.name;
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.active !== undefined) user.active = dto.active;

    return this.userRepository.save(user);
  }

  async resetPassword(id: string): Promise<ResetPasswordResult> {
    const user = await this.findByIdOrThrow(id);
    const tempPassword = this.generateTempPassword();

    user.passwordHash = await bcrypt.hash(tempPassword, BCRYPT_COST);
    user.mustChangePassword = true;
    const saved = await this.userRepository.save(user);

    await this.emailService.sendPasswordResetEmail(
      saved.email,
      saved.name,
      tempPassword,
      this.portalUrl(),
    );
    return { user: saved, tempPassword };
  }

  async deactivate(id: string, currentUserId: string): Promise<User> {
    if (id === currentUserId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    const user = await this.findByIdOrThrow(id);
    if (user.role === UserRole.ADMIN) {
      await this.assertAnotherActiveAdminExists(id);
    }
    user.active = false;
    return this.userRepository.save(user);
  }

  async changeOwnPassword(userId: string, dto: ChangePasswordDto): Promise<User> {
    const user = await this.findByIdOrThrow(userId);
    const matches = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    user.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_COST);
    user.mustChangePassword = false;
    return this.userRepository.save(user);
  }

  private async assertAnotherActiveAdminExists(excludingUserId: string): Promise<void> {
    const activeAdminCount = await this.userRepository.count({
      where: { role: UserRole.ADMIN, active: true },
    });
    const excludedUser = await this.userRepository.findOne({ where: { id: excludingUserId } });
    const excludedIsActiveAdmin = excludedUser?.role === UserRole.ADMIN && excludedUser.active;
    const remaining = excludedIsActiveAdmin ? activeAdminCount - 1 : activeAdminCount;

    if (remaining < 1) {
      throw new BadRequestException('At least one active admin must always exist');
    }
  }

  private generateTempPassword(): string {
    return randomBytes(9).toString('base64url');
  }

  private portalUrl(): string {
    return this.configService.get<string>('FRONTEND_ORIGIN') ?? '';
  }
}
