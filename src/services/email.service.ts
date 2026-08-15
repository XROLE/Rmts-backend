import 'dotenv/config';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface SupportEmailPayload {
  title: string;
  message: string;
  userId: string;
  userEmail?: string;
}

/**
 * Sends application emails via SMTP. Configured for Gmail by default.
 * Uses an app password on the sending account (SMTP_USER / SMTP_PASS).
 */
export class EmailService {
  private transporter: Transporter;

  constructor() {
    const host = process.env.SMTP_HOST ?? 'smtp.gmail.com';
    const port = Number(process.env.SMTP_PORT ?? 465);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });
  }

  async sendSupportTicket(payload: SupportEmailPayload): Promise<void> {
    const supportEmail =
      process.env.SUPPORT_EMAIL ?? 'urbannest.quick.support@gmail.com';

    const text = [
      `New support ticket from Roommate NG`,
      ``,
      `User ID: ${payload.userId}`,
      payload.userEmail ? `User email: ${payload.userEmail}` : ``,
      ``,
      `Title: ${payload.title}`,
      ``,
      `Message:`,
      payload.message,
    ]
      .filter((line) => line !== '')
      .join('\n');

    const html = `
      <h2>New support ticket</h2>
      <p><strong>User ID:</strong> ${payload.userId}</p>
      ${payload.userEmail ? `<p><strong>User email:</strong> ${payload.userEmail}</p>` : ''}
      <p><strong>Title:</strong> ${this.escapeHtml(payload.title)}</p>
      <p><strong>Message:</strong></p>
      <pre>${this.escapeHtml(payload.message)}</pre>
    `;

    await this.transporter.sendMail({
      from: process.env.SMTP_USER
        ? `"Roommate NG" <${process.env.SMTP_USER}>`
        : supportEmail,
      to: supportEmail,
      subject: `[Support] ${payload.title}`,
      text,
      html,
    });
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

export const emailService = new EmailService();
