/**
 * Email delivery via Resend
 *
 * Production email service for OpenMAIC auth flows.
 * Uses Resend (https://resend.com) for transactional email.
 */

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export async function sendEmail({ to, subject, html, from }: SendEmailParams) {
  const fromAddress = from || process.env.EMAIL_FROM || 'OpenMAIC <noreply@coachingthegist.com>';

  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to,
      subject,
      html,
    });

    if (error) {
      console.error('[Email] Resend error:', error);
      throw new Error(`Email send failed: ${error.message}`);
    }

    console.log('[Email] Sent to:', to, 'ID:', data?.id);
    return { success: true, id: data?.id };
  } catch (err: any) {
    console.error('[Email] sendEmail error:', err.message);
    throw err;
  }
}

/**
 * Send password reset email with token link.
 * Neutral message regardless of whether email exists (anti-enumeration).
 */
export async function sendPasswordResetEmail(
  email: string,
  resetUrl: string,
  userName?: string
) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #f9fafb; border-radius: 12px; padding: 32px; margin: 20px 0;">
        <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 16px;">Reset your password</h1>
        <p style="margin: 0 0 16px; color: #4b5563;">
          ${userName ? `Hi ${userName},` : 'Hello,'}
        </p>
        <p style="margin: 0 0 24px; color: #4b5563;">
          We received a request to reset your OpenMAIC password. Click the button below to set a new password. This link expires in 1 hour.
        </p>
        <a href="${resetUrl}" style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
          Reset Password
        </a>
        <p style="margin: 24px 0 0; color: #6b7280; font-size: 14px;">
          If you didn't request this, you can safely ignore this email. Your password will remain unchanged.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="margin: 0; color: #9ca3af; font-size: 13px;">
          If the button doesn't work, copy and paste this link:<br>
          <a href="${resetUrl}" style="color: #2563eb; word-break: break-all;">${resetUrl}</a>
        </p>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: 'Reset your OpenMAIC password',
    html,
  });
}

/**
 * Send password reset confirmation email.
 */
export async function sendPasswordResetConfirmationEmail(email: string, userName?: string) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #f0fdf4; border-radius: 12px; padding: 32px; margin: 20px 0; border: 1px solid #bbf7d0;">
        <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 16px; color: #166534;">Password updated</h1>
        <p style="margin: 0; color: #166534;">
          ${userName ? `${userName}, y` : 'Y'}our OpenMAIC password has been successfully changed.
          If you did not make this change, contact your administrator immediately.
        </p>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: 'Your OpenMAIC password has been changed',
    html,
  });
}
