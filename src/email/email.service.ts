import { SendEmailCommand, SESClient } from '@aws-sdk/client-ses';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  inviteEmailTemplate,
  otpEmailTemplate,
  passwordResetEmailTemplate,
} from './email.templates';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly client: SESClient;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    this.client = new SESClient({ region: this.configService.get<string>('AWS_REGION') });
    this.from = this.configService.get<string>('EMAIL_FROM') ?? 'no-reply@example.com';
  }

  /** OTP delivery has no fallback, so a send failure propagates — the caller must tell the user it didn't go out. */
  async sendOtpEmail(to: string, code: string, purpose: 'LOGIN' | 'SETUP'): Promise<void> {
    const { subject, html } = otpEmailTemplate(code, purpose);
    await this.send(to, subject, html);
  }

  /** Invite/reset emails have a UI fallback (the temp password is shown to the admin), so failures are swallowed. */
  async sendInviteEmail(
    to: string,
    name: string,
    tempPassword: string,
    portalUrl: string,
  ): Promise<void> {
    const { subject, html } = inviteEmailTemplate(name, tempPassword, portalUrl);
    await this.sendBestEffort(to, subject, html);
  }

  async sendPasswordResetEmail(
    to: string,
    name: string,
    tempPassword: string,
    portalUrl: string,
  ): Promise<void> {
    const { subject, html } = passwordResetEmailTemplate(name, tempPassword, portalUrl);
    await this.sendBestEffort(to, subject, html);
  }

  private async sendBestEffort(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.send(to, subject, html);
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${to}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private send(to: string, subject: string, html: string): Promise<unknown> {
    return this.client.send(
      new SendEmailCommand({
        Source: this.from,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Html: { Data: html, Charset: 'UTF-8' } },
        },
      }),
    );
  }
}
