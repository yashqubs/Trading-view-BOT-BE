import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class TradingViewIpGuard implements CanActivate {
  private readonly logger = new Logger(TradingViewIpGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const allowedIps = this.configService
      .get<string>('TRADINGVIEW_IPS', '')
      .split(',')
      .map((ip) => ip.trim())
      .filter((ip) => ip.length > 0);

    const requestIp = this.extractClientIp(request);

    if (!allowedIps.includes(requestIp)) {
      this.logger.warn(`Rejected webhook from non-whitelisted IP: ${requestIp}`);
      throw new ForbiddenException('Request origin not allowed');
    }

    return true;
  }

  // X-Forwarded-For is `client, proxy1, proxy2, ...` — each hop APPENDS the
  // address it received the request from. The leftmost entry is whatever the
  // client claimed (attacker-controlled: `curl -H "X-Forwarded-For: <a
  // whitelisted IP>"` trivially spoofs it and bypasses this guard entirely).
  // The rightmost entry is what our own reverse proxy actually observed,
  // which is the only part that can't be forged. This assumes exactly one
  // trusted proxy hop in front of the app (Nginx on the same EC2 instance,
  // per the documented architecture) with no CDN/load balancer further out —
  // if that topology ever changes, this must be revisited.
  private extractClientIp(request: Request): string {
    const forwardedFor = request.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
      const hops = forwardedFor.split(',').map((ip) => ip.trim());
      return hops[hops.length - 1] ?? '';
    }
    return request.ip ?? request.socket.remoteAddress ?? '';
  }
}
