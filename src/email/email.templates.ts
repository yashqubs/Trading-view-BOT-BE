const ACCENT = '#22d3ee';
const BG = '#0a0e1a';
const SURFACE = '#121826';
const TEXT_PRIMARY = '#e8ecf4';
const TEXT_SECONDARY = '#9aa4b8';

function layout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:32px 16px;background:${BG};font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;">
      <tr>
        <td style="padding-bottom:24px;text-align:center;">
          <span style="display:inline-block;width:36px;height:36px;border-radius:10px;background:${ACCENT};color:${BG};font-weight:700;font-size:18px;line-height:36px;text-align:center;">T</span>
          <div style="margin-top:8px;color:${TEXT_PRIMARY};font-size:14px;font-weight:600;">TradingBot Portal</div>
        </td>
      </tr>
      <tr>
        <td style="background:${SURFACE};border-radius:16px;padding:32px 28px;border:1px solid rgba(255,255,255,0.08);">
          <h1 style="margin:0 0 12px;color:${TEXT_PRIMARY};font-size:18px;">${title}</h1>
          ${bodyHtml}
        </td>
      </tr>
      <tr>
        <td style="padding-top:20px;text-align:center;color:${TEXT_SECONDARY};font-size:12px;">
          If you didn't expect this email, you can safely ignore it.
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function otpEmailTemplate(
  code: string,
  purpose: 'LOGIN' | 'SETUP' | 'RESET',
): { subject: string; html: string } {
  const intro =
    purpose === 'LOGIN'
      ? 'Use this code to finish signing in.'
      : purpose === 'SETUP'
        ? 'Use this code to confirm enabling two-factor authentication.'
        : 'Use this code to reset your password.';

  return {
    subject: `Your verification code: ${code}`,
    html: layout(
      'Your verification code',
      `
        <p style="margin:0 0 20px;color:${TEXT_SECONDARY};font-size:14px;">${intro}</p>
        <div style="text-align:center;margin:0 0 20px;">
          <span style="display:inline-block;letter-spacing:8px;font-size:32px;font-weight:700;color:${ACCENT};background:rgba(34,211,238,0.1);padding:14px 20px;border-radius:12px;">${code}</span>
        </div>
        <p style="margin:0;color:${TEXT_SECONDARY};font-size:13px;">This code expires in 10 minutes. Never share it with anyone.</p>
      `,
    ),
  };
}

export function inviteEmailTemplate(
  name: string,
  tempPassword: string,
  portalUrl: string,
): { subject: string; html: string } {
  return {
    subject: 'Your TradingBot Portal account is ready',
    html: layout(
      `Welcome, ${name}`,
      `
        <p style="margin:0 0 20px;color:${TEXT_SECONDARY};font-size:14px;">
          An account was created for you on the TradingBot Portal. Use the temporary password below to sign in — you'll be asked to set your own password right away.
        </p>
        <div style="margin:0 0 20px;padding:14px 16px;background:rgba(34,211,238,0.1);border-radius:10px;">
          <div style="color:${TEXT_SECONDARY};font-size:12px;margin-bottom:4px;">Temporary password</div>
          <div style="color:${TEXT_PRIMARY};font-size:18px;font-family:monospace;letter-spacing:1px;">${tempPassword}</div>
        </div>
        <div style="text-align:center;">
          <a href="${portalUrl}" style="display:inline-block;background:${ACCENT};color:${BG};font-weight:600;font-size:14px;text-decoration:none;padding:12px 24px;border-radius:10px;">Open the portal</a>
        </div>
      `,
    ),
  };
}

export function passwordResetEmailTemplate(
  name: string,
  tempPassword: string,
  portalUrl: string,
): { subject: string; html: string } {
  return {
    subject: 'Your TradingBot Portal password was reset',
    html: layout(
      `Password reset, ${name}`,
      `
        <p style="margin:0 0 20px;color:${TEXT_SECONDARY};font-size:14px;">
          An admin reset your password. Use the temporary password below to sign in — you'll be asked to set your own password right away.
        </p>
        <div style="margin:0 0 20px;padding:14px 16px;background:rgba(34,211,238,0.1);border-radius:10px;">
          <div style="color:${TEXT_SECONDARY};font-size:12px;margin-bottom:4px;">Temporary password</div>
          <div style="color:${TEXT_PRIMARY};font-size:18px;font-family:monospace;letter-spacing:1px;">${tempPassword}</div>
        </div>
        <div style="text-align:center;">
          <a href="${portalUrl}" style="display:inline-block;background:${ACCENT};color:${BG};font-weight:600;font-size:14px;text-decoration:none;padding:12px 24px;border-radius:10px;">Open the portal</a>
        </div>
      `,
    ),
  };
}
