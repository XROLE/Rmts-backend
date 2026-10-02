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
      <!-- Tailwind CSS v3 with forms and container queries -->
      <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
      <script>
        tailwind.config = {
          theme: {
            extend: {
              colors: {
                brand: {
                  navy: '#080E21',
                  slate: '#0F172A',
                  muted: '#475569',
                  lightslate: '#64748B',
                  blue: '#0284C7',
                  cyan: '#2EB1FF',
                  border: '#E2E8F0',
                  bg: '#F8FAFC'
                }
              },
              fontFamily: {
                sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
                mono: ['"SF Mono"', 'Consolas', '"Liberation Mono"', 'Menlo', 'monospace']
              }
            }
          }
        }
      </script>
      <!-- Google Font: Plus Jakarta Sans -->
      <link href="https://fonts.googleapis.com" rel="preconnect"/>
      <link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect"/>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&amp;family=Space+Mono:wght@700&amp;display=swap" rel="stylesheet"/>
      <style data-purpose="custom-typography">
        body {
          font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        .code-display {
          font-family: 'Space Mono', 'SF Mono', Consolas, monospace;
          letter-spacing: 0.35em;
        }
        .copy-toast {
          transition: opacity 0.2s ease, transform 0.2s ease;
        }
      </style>
      </head>
      <body class="bg-[#F1F5F9] text-brand-slate min-h-screen py-6 sm:py-12 px-4 flex items-center justify-center">
      <!-- BEGIN: EmailWrapper -->
      <main class="w-full max-w-[600px] bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden" data-purpose="email-container">
      <!-- Top Decorative Brand Bar -->
      <div class="h-1.5 w-full bg-gradient-to-r from-brand-navy via-brand-blue to-brand-cyan" data-purpose="accent-bar"></div>
      <!-- Inner Padding Container -->
      <div class="px-7 sm:px-12 pt-10 pb-12">
      <!-- BEGIN: BrandHeader -->
      <header class="mb-10 flex items-center justify-between" data-purpose="header-section">
      <div class="inline-flex items-center gap-3">
      <div class="relative w-11 h-11 bg-brand-navy rounded-xl p-2 flex items-center justify-center shadow-md shadow-brand-navy/10 ring-1 ring-black/5">
      <svg class="w-7 h-7" fill="none" viewbox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 6.5C7 5.67157 7.67157 5 8.5 5H18C18.8284 5 19.5 5.67157 19.5 6.5C19.5 7.32843 18.8284 8 18 8H10V13H16.5C17.3284 13 18 13.6716 18 14.5C18 15.3284 17.3284 16 16.5 16H10V26C10 26.8284 9.32843 27.5 8.5 27.5C7.67157 27.5 7 26.8284 7 26V6.5Z" fill="#FFFFFF"></path>
      <path d="M14.5 14L22.8 25.4C23.2 26 23.9 26.4 24.7 26.4C25.4 26.4 26 25.8 26 25V12C26 11.2 25.3 10.5 24.5 10.5C23.7 10.5 23 11.2 23 12V20.8L16.2 11.5C15.7 10.8 14.9 10.4 14.1 10.5C13.8 10.6 13.5 10.8 13.3 11C13.1 11.2 13 11.5 13 11.8V15.5H16V14H14.5Z" fill="#2EB1FF"></path>
      <circle cx="24.5" cy="6.5" fill="#38BDF8" r="2.5"></circle>
      </svg>
      </div>
      <span class="font-extrabold text-xl sm:text-[22px] tracking-tight text-brand-navy flex items-center">
      FairNest<span class="text-brand-blue font-semibold ml-1.5 text-base sm:text-lg">Housing</span>
      </span>
      </div>
      <!-- Security Badge -->
      <span class="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
      <svg class="w-3.5 h-3.5 text-emerald-600" fill="currentColor" viewbox="0 0 20 20">
      <path clip-rule="evenodd" d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM11 14a1 1 0 11-2 0 1 1 0 012 0zm0-7a1 1 0 10-2 0v3a1 1 0 102 0V7z" fill-rule="evenodd"></path>
      </svg>
      Secure Sign In
      </span>
      </header>
      <!-- END: BrandHeader -->
      <!-- BEGIN: ContentBody -->
      <section data-purpose="verification-body">
      <h1 class="text-3xl sm:text-[38px] leading-[1.15] font-extrabold text-[#080E21] tracking-tight mb-8">
      Enter this code to sign in
      </h1>
      <div class="mb-9" data-purpose="passcode-container">
      <div class="inline-block bg-[#F8FAFC] border border-slate-200/90 rounded-2xl px-6 sm:px-8 py-4 sm:py-5 shadow-inner">
      <span class="code-display text-4xl sm:text-[46px] font-bold text-[#080E21] select-all cursor-pointer block text-left" title="Click to copy code">
      ${this.escapeHtml(codeDisplay)}
      </span>
      </div>
      <p class="text-xs text-brand-lightslate mt-2 font-medium flex items-center gap-1.5">
      <svg class="w-3.5 h-3.5 text-brand-blue" fill="none" stroke="currentColor" viewbox="0 0 24 24">
      <path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
      </svg>
      Click or tap code to select &amp; copy
      </p>
      </div>
      <div class="space-y-5 text-[16px] sm:text-[17px] text-[#334155] leading-relaxed mb-10 font-normal">
      <p>
      Enter the code above on your device to sign in to FairNest Housing. This code will expire in <strong class="font-semibold text-brand-slate">10 minutes</strong>.
      </p>
      <p>
      If you didn't send this request, you can ignore this email.
      </p>
      <p class="text-slate-600">
      To protect your roommate profile and housing preferences, don't share this code with anyone outside your trusted household.
      </p>
      </div>
      <div class="pt-1 pb-2 font-bold text-[17px] text-brand-navy" data-purpose="sign-off">
      The FairNest team
      </div>
      </section>
      <!-- END: ContentBody -->
      <!-- Crisp Horizontal Divider -->
      <hr class="my-9 border-t-2 border-slate-100"/>
      <!-- BEGIN: EmailFooter -->
      <footer class="pt-2 text-xs sm:text-[13px] text-slate-500 space-y-6" data-purpose="email-footer">
      <div class="flex items-start gap-4">
      <div class="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex-shrink-0 flex items-center justify-center p-1.5 mt-0.5">
      <svg class="w-full h-full opacity-70" fill="none" viewbox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 6.5C7 5.67157 7.67157 5 8.5 5H18C18.8284 5 19.5 5.67157 19.5 6.5C19.5 7.32843 18.8284 8 18 8H10V13H16.5C17.3284 13 18 13.6716 18 14.5C18 15.3284 17.3284 16 16.5 16H10V26C10 26.8284 9.32843 27.5 8.5 27.5C7.67157 27.5 7 26.8284 7 26V6.5Z" fill="#080E21"></path>
      <path d="M14.5 14L22.8 25.4C23.2 26 23.9 26.4 24.7 26.4C25.4 26.4 26 25.8 26 25V12C26 11.2 25.3 10.5 24.5 10.5C23.7 10.5 23 11.2 23 12V20.8L16.2 11.5C15.7 10.8 14.9 10.4 14.1 10.5C13.8 10.6 13.5 10.8 13.3 11C13.1 11.2 13 11.5 13 11.8V15.5H16V14H14.5Z" fill="#0284C7"></path>
      </svg>
      </div>
      <div class="space-y-1">
      <p class="text-slate-600 font-medium">
      Questions? Visit the Help Center
      </p>
      <p class="text-slate-400 text-[12px]">
      FairNest Housing Technologies Limited • Co-living &amp; Verified Roommates
      </p>
      </div>
      </div>
      <nav aria-label="Footer Navigation" class="flex flex-wrap gap-x-5 gap-y-2 text-[12.5px] text-slate-500 pt-1">
      <a class="hover:text-brand-navy underline underline-offset-2 transition-colors" href="#terms">Terms of Use</a>
      <a class="hover:text-brand-navy underline underline-offset-2 transition-colors" href="#privacy">Privacy Policy</a>
      </nav>
      <div class="text-[12px] text-slate-400 border-t border-slate-100 pt-5 leading-normal">
      This message was mailed to <span class="text-slate-600 font-mono font-medium">${this.escapeHtml(to)}</span> by FairNest Housing as part of your account security protocols.
      </div>
      </footer>
      <!-- END: EmailFooter -->
      </div>
      </main>
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