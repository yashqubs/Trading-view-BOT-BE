import { UserRole } from '../../common/enums';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  /** True for the restricted session issued while the user still has a forced password change pending. */
  pending: boolean;
}
