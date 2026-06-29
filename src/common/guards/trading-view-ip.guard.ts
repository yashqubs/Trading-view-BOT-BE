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

  private extractClientIp(request: Request): string {
    const forwardedFor = request.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
      return forwardedFor.split(',')[0].trim();
    }
    return request.ip ?? request.socket.remoteAddress ?? '';
  }
}
