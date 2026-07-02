import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Unauthenticated on purpose — this is what a load balancer, uptime monitor,
 * or the CI/CD deploy step curls after a restart to confirm the app is
 * actually serving requests again (not just that the process is running).
 * Every other route needs a JWT, a webhook secret, or an active IG session
 * to mean anything, so none of them work as a plain liveness check.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async check(): Promise<{ status: 'ok'; timestamp: string }> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new HttpException('Database unreachable', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
