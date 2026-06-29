import { exec } from 'child_process';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TokenBlacklistService } from '../auth/token-blacklist.service';
import { IgClientService } from '../ig-client/ig-client.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly igClientService: IgClientService,
    private readonly tokenBlacklistService: TokenBlacklistService,
    private readonly configService: ConfigService,
  ) {}

  /** IG session tokens (CST/X-SECURITY-TOKEN) are valid ~4 hours; refresh ahead of expiry. */
  @Cron('0 */3 * * *')
  async refreshIgSession(): Promise<void> {
    try {
      await this.igClientService.refreshSession();
      this.logger.log('IG session refreshed');
    } catch (error) {
      this.logger.error('Scheduled IG session refresh failed', (error as Error).message);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpiredBlacklistedTokens(): Promise<void> {
    await this.tokenBlacklistService.purgeExpired();
  }

  /**
   * Triggers the nightly DB backup. The dump/upload logic lives in
   * .claude/scripts/backup-to-s3.sh (single source of truth, also runnable
   * directly from an OS crontab per .claude/README.md) — this just invokes
   * it on schedule so backups don't depend on the EC2 crontab being set up
   * separately. The script path is operator-configured via env, not
   * user input. No-op outside production (dev machines won't have AWS
   * credentials or the script's expected environment).
   */
  @Cron('0 2 * * *')
  runNightlyBackup(): void {
    if (this.configService.get<string>('NODE_ENV') !== 'production') {
      return;
    }

    const scriptPath = this.configService.get<string>(
      'BACKUP_SCRIPT_PATH',
      '.claude/scripts/backup-to-s3.sh',
    );

    exec(scriptPath, (error, _stdout, stderr) => {
      if (error) {
        this.logger.error(`Nightly backup failed: ${stderr || error.message}`);
      } else {
        this.logger.log('Nightly backup completed');
      }
    });
  }
}
