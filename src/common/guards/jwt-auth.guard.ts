import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ALLOW_PENDING_SESSION_KEY } from '../decorators/allow-pending-session.decorator';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isAuthenticated = await (super.canActivate(context) as Promise<boolean>);
    if (!isAuthenticated) {
      return false;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;

    const allowsPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_SESSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (user.pending && !allowsPending) {
      throw new ForbiddenException('Finish setting up 2FA and changing your password to continue');
    }

    return true;
  }
}
