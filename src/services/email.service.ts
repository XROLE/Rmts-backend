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

    const codeDisplay = [...code].join(' ');

    const text = [
      `Enter this code to sign in to FairNest Housing: ${code}`,
      ``,
      `This code will expire in 10 minutes.`,
      ``,
      `To protect your roommate profile and housing preferences, don't share this code with anyone outside your trusted household.`,
      ``,
      `If you didn't send this request, you can ignore this email.`,
      ``,
      `The FairNest team`,
    ].join('\n');

    const html = `
      <!DOCTYPE html>
      <html lang="en"><head>
      <meta charset="utf-8"/>
      <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
      <title>FairNest Housing - Verification Code</title>
      <!-- Google Font: Plus Jakarta Sans -->
      <link href="https://fonts.googleapis.com" rel="preconnect"/>
      <link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect"/>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&amp;display=swap" rel="stylesheet"/>
      <style data-purpose="email-resets">
        body { margin: 0; padding: 0; }
        table { border-collapse: collapse; }
      </style>
      </head>
      <body style="margin:0; padding:0; background-color:#F1F5F9; font-family:Plus Jakarta Sans,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif; -webkit-font-smoothing:antialiased;">
      <!-- BEGIN: EmailWrapper -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F1F5F9;">
      <tr>
      <td align="center" style="padding:0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; background-color:#FFFFFF; border:1px solid #E2E8F0; border-radius:16px;">
      <!-- Top Decorative Brand Bar -->
      <tr>
      <td height="6" style="height:6px; font-size:0; line-height:0; background-color:#080E21; background-image:linear-gradient(to right,#080E21,#0284C7,#2EB1FF);"></td>
      </tr>
      <!-- Inner Padding Container -->
      <tr>
      <td style="padding:20px 20px 16px;">
      <!-- BEGIN: BrandHeader -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
      <td valign="middle">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
      <td valign="middle">
      <div style="width:44px; height:44px; background-color:#080E21; border-radius:12px; text-align:center; line-height:44px; font-size:24px; font-weight:800; color:#FFFFFF;">F</div>
      </td>
      <td valign="middle" style="padding-left:12px;">
      <span style="font-size:22px; font-weight:800; color:#080E21; letter-spacing:-0.02em;">FairNest<span style="color:#0284C7; font-weight:600; font-size:17px;"> Housing</span></span>
      </td>
      </tr>
      </table>
      </td>
      <td align="right" valign="middle">
      <span style="display:inline-block; padding:4px 12px; border-radius:999px; background-color:#ECFDF5; color:#047857; border:1px solid #A7F3D0; font-size:12px; font-weight:600;">Secure Sign In</span>
      </td>
      </tr>
      </table>
      <!-- END: BrandHeader -->
      <!-- BEGIN: ContentBody -->
      <h1 style="margin:0 0 16px; font-size:28px; font-weight:800; color:#080E21; line-height:1.15; letter-spacing:-0.03em;">
      Enter this code to sign in
      </h1>
      <!-- High-Impact Verification Code Display -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;">
      <tr>
      <td style="background-color:#F8FAFC; border:1px solid #E2E8F0; border-radius:16px; padding:10px 24px;">
      <div style="font-family:Space Mono,SF Mono,Consolas,Menlo,monospace; font-size:34px; font-weight:700; color:#080E21; letter-spacing:0.2em; line-height:1.2; text-align:left;">
      ${this.escapeHtml(codeDisplay)}
      </div>
      </td>
      </tr>
      </table>
      <p style="margin:0 0 12px; font-size:12px; color:#64748B; font-weight:500;">Click or tap code to select &amp; copy</p>
      <!-- Instructional Paragraphs -->
      <div style="margin-bottom:16px; font-size:15px; color:#334155; line-height:1.5;">
      <p style="margin:0;">
      Enter the code above on your device to sign in to FairNest Housing. This code will expire in <strong style="font-weight:600; color:#0F172A;">10 minutes</strong>.<br/><br/>
      If you didn't send this request, you can ignore this email.<br/><br/>
      <span style="color:#475569;">To protect your roommate profile and housing preferences, don't share this code with anyone outside your trusted household.</span>
      </p>
      </div>
      <!-- Sign-off Block -->
      <div style="padding:2px 0 4px; font-size:15px; font-weight:700; color:#080E21;">
      The FairNest team
      </div>
      <!-- END: ContentBody -->
      <!-- Crisp Horizontal Divider -->
      <hr style="margin:16px 0; border:none; border-top:2px solid #F1F5F9;"/>
      <!-- BEGIN: EmailFooter -->
      <div style="font-size:13px; color:#64748B;">
      <!-- Support Links & Entity Lockup -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
      <td valign="top" width="36">
      <div style="width:32px; height:32px; background-color:#F1F5F9; border:1px solid #E2E8F0; border-radius:8px; text-align:center; line-height:32px; font-size:16px; font-weight:700; color:#080E21;">F</div>
      </td>
      <td valign="top" style="padding-left:12px;">
      <p style="margin:0 0 4px; font-size:13px; color:#475569; font-weight:500;">Questions? Visit the Help Center</p>
      <p style="margin:0; font-size:12px; color:#94A3B8;">FairNest Housing Technologies Limited &bull; Co-living &amp; Verified Roommates</p>
      </td>
      </tr>
      <!-- Legal & Account Navigation -->
      <tr>
      <td colspan="2" style="padding:6px 0 0; font-size:12.5px;">
      <a href="https://www.fairnesthousing.com/legal/terms" style="color:#64748B; text-decoration:underline; margin-right:18px;">Terms of Use</a>
      <a href="https://www.fairnesthousing.com/legal/privacy" style="color:#64748B; text-decoration:underline;">Privacy Policy</a>
      </td>
      </tr>
      <!-- Audit & Transmission Microcopy -->
      <tr>
      <td colspan="2" style="padding:12px 0 0; border-top:1px solid #F1F5F9; font-size:12px; color:#94A3B8; line-height:1.5;">
      This message was mailed to <span style="color:#475569; font-family:Consolas,Menlo,monospace; font-weight:500;">${this.escapeHtml(to)}</span> by FairNest Housing as part of your account security protocols.
      </td>
      </tr>
      </table>
      </div>
      <!-- END: EmailFooter -->
      </td>
      </tr>
      </table>
      </td>
      </tr>
      </table>
      <!-- END: EmailWrapper -->
      </body></html>
    `;

    await this.send({
      to,
      subject: 'FairNest Housing Verification Code',
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