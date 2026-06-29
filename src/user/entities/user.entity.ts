import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '../../common/enums';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Exclude()
  @Column({ type: 'varchar', length: 255, name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'varchar', length: 20, default: UserRole.VIEWER })
  role: UserRole;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Exclude()
  @Column({ type: 'varchar', length: 255, nullable: true, name: 'totp_secret' })
  totpSecret: string | null;

  @Column({ type: 'boolean', default: false, name: 'totp_enabled' })
  totpEnabled: boolean;

  @Exclude()
  @Column({ type: 'text', nullable: true, name: 'recovery_codes' })
  recoveryCodes: string | null;

  @Column({ type: 'boolean', default: true, name: 'must_change_password' })
  mustChangePassword: boolean;

  @Column({ type: 'int', default: 0, name: 'failed_login_attempts' })
  failedLoginAttempts: number;

  @Column({ type: 'timestamptz', nullable: true, name: 'locked_until' })
  lockedUntil: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'last_login_at' })
  lastLoginAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
