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
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
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

  /**
   * Notifies the support inbox that Sido handed a WhatsApp conversation over
   * to a human agent. Best effort and fire-and-forget, matching the support
   * ticket pattern.
   */
  async sendHumanHandover(payload: {
    phone: string;
    name: string;
    summary: string;
  }): Promise<void> {
    const supportEmail =
      process.env.SUPPORT_EMAIL ?? 'urbannest.quick.support@gmail.com';

    const subject = process.env.SIDO_HANDOVER_SUBJECT ?? 'WhatsApp handover';

    const text = [
      `Sido handed a WhatsApp conversation over to a human agent`,
      ``,
      `User name: ${payload.name}`,
      `WhatsApp number: ${payload.phone}`,
      ``,
      `Summary: ${payload.summary || '(no summary provided)'}`,
      ``,
      `Reply to the user directly from the business WhatsApp number, then clear`,
      `the handover via POST /api/v1/whatsapp/bot/resume (phone = ${payload.phone}).`,
    ]
      .filter((line) => line !== '')
      .join('\n');

    const html = `
      <h2>Sido — WhatsApp handover</h2>
      <p><strong>User name:</strong> ${this.escapeHtml(payload.name)}</p>
      <p><strong>WhatsApp number:</strong> ${this.escapeHtml(payload.phone)}</p>
      <p><strong>Summary:</strong></p>
      <pre>${this.escapeHtml(payload.summary || '(no summary provided)')}</pre>
      <p>Reply to the user directly from the business WhatsApp number, then clear
      the handover via <code>POST /api/v1/whatsapp/bot/resume</code>
      (phone = ${this.escapeHtml(payload.phone)}).</p>
    `;

    await this.transporter.sendMail({
      from: process.env.SMTP_USER
        ? `"Roommate NG" <${process.env.SMTP_USER}>`
        : supportEmail,
      to: supportEmail,
      subject: `[${subject}] ${payload.name} (${payload.phone})`,
      text,
      html,
    });
  }

  /**
   * Notifies the careers inbox that a job application was submitted.
   * Best-effort and fire-and-forget, matching the support ticket pattern.
   */
  async sendJobApplication(payload: {
    fullName: string;
    email: string;
    phone: string;
    position: string;
    location: string;
    noticePeriod: string;
    expectedSalary: string;
    coverNote: string;
    resumeUrl?: string;
    linkedinUrl?: string;
    githubUrl?: string;
  }): Promise<void> {
    const supportEmail =
      process.env.SUPPORT_EMAIL ?? 'urbannest.quick.support@gmail.com';

    const text = [
      `New job application from Roommate NG`,
      ``,
      `Full name: ${payload.fullName}`,
      `Email: ${payload.email}`,
      `Phone: ${payload.phone}`,
      `Position: ${payload.position}`,
      `Location: ${payload.location}`,
      `Notice period: ${payload.noticePeriod}`,
      `Expected salary: ${payload.expectedSalary}`,
      payload.linkedinUrl ? `LinkedIn: ${payload.linkedinUrl}` : '',
      payload.githubUrl ? `GitHub: ${payload.githubUrl}` : '',
      payload.resumeUrl ? `Resume: ${payload.resumeUrl}` : '',
      ``,
      `Cover note:`,
      payload.coverNote,
    ]
      .filter((line) => line !== '')
      .join('\n');

    const html = `
      <h2>New job application</h2>
      <p><strong>Full name:</strong> ${this.escapeHtml(payload.fullName)}</p>
      <p><strong>Email:</strong> ${this.escapeHtml(payload.email)}</p>
      <p><strong>Phone:</strong> ${this.escapeHtml(payload.phone)}</p>
      <p><strong>Position:</strong> ${this.escapeHtml(payload.position)}</p>
      <p><strong>Location:</strong> ${this.escapeHtml(payload.location)}</p>
      <p><strong>Notice period:</strong> ${this.escapeHtml(payload.noticePeriod)}</p>
      <p><strong>Expected salary:</strong> ${this.escapeHtml(payload.expectedSalary)}</p>
      ${payload.linkedinUrl ? `<p><strong>LinkedIn:</strong> ${this.escapeHtml(payload.linkedinUrl)}</p>` : ''}
      ${payload.githubUrl ? `<p><strong>GitHub:</strong> ${this.escapeHtml(payload.githubUrl)}</p>` : ''}
      ${payload.resumeUrl ? `<p><strong>Resume:</strong> <a href="${this.escapeHtml(payload.resumeUrl)}">${this.escapeHtml(payload.resumeUrl)}</a></p>` : ''}
      <p><strong>Cover note:</strong></p>
      <pre>${this.escapeHtml(payload.coverNote)}</pre>
    `;

    await this.transporter.sendMail({
      from: process.env.SMTP_USER
        ? `"Roommate NG" <${process.env.SMTP_USER}>`
        : supportEmail,
      to: supportEmail,
      subject: `[Job Application] ${payload.position} — ${payload.fullName}`,
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
