import { UserRole } from '../../common/enums';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  /** True for the restricted pre-2FA session issued by POST /auth/login. */
  pending: boolean;
}
