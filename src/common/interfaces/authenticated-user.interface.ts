import { UserRole } from '../enums';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  /** True for the restricted session issued while the user still has a forced password change pending. */
  pending: boolean;
}
