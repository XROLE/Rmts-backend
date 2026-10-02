import 'dotenv/config';
import { Resend } from 'resend';

export interface SupportEmailPayload {
  title: string;
  message: string;
  userId: string;
  userEmail?: string;
}

const DEFAULT_RESEND_FROM = '"Roommate NG" <onboarding@resend.dev>';

/**
 * Sends application emails via Resend. Requires RESEND_API_KEY and a verified
 * RESEND_FROM sender (a domain you own in Resend, or onboarding@resend.dev in
 * test). A missing API key only fails at send-time so a config-less local run
 * does not crash on boot.
 */
export class EmailService {
  private resend: Resend | null;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  private resolveFrom(): string {
    return process.env.RESEND_FROM ?? DEFAULT_RESEND_FROM;
  }

  private async send(payload: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<void> {
    if (!this.resend) {
      throw new Error(
        'Email service is not configured. Set RESEND_API_KEY and RESEND_FROM in your environment.',
      );
    }

    try {
      const { error } = await this.resend.emails.send({
        from: this.resolveFrom(),
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      });

      if (error) {
        throw new Error(error.message);
      }
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error('Failed to send email via Resend');
    }
  }

  /**
   * Sends a one-time verification code to the user's email address.
   */
  async sendVerificationCode(payload: { to: string; code: string }): Promise<void> {
    const { to, code } = payload;

    const text = [
      `Your Roommate NG verification code is ${code}.`,
      ``,
      `It expires in 10 minutes.`,
      ``,
      `If you did not request this code, you can safely ignore this email.`,
    ].join('\n');

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Verify your email</h2>
        <p>Your Roommate NG verification code is:</p>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px; margin: 16px 0;">${this.escapeHtml(code)}</p>
        <p>It expires in 10 minutes.</p>
        <p style="color: #666;">If you did not request this code, you can safely ignore this email.</p>
      </div>
    `;

    await this.send({
      to,
      subject: 'Your Roommate NG verification code',
      text,
      html,
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

    await this.send({
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

    await this.send({
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

    await this.send({
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