export interface AuthenticatedUser {
  id: string;
  email: string;
  /** True for the restricted session issued while the user still has a forced password change pending. */
  pending: boolean;
}
