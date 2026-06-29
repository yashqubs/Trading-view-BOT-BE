import { UserRole } from '../enums';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  /** True for the restricted pre-2FA session issued by POST /auth/login. */
  pending: boolean;
}
