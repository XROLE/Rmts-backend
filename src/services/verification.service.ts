import 'dotenv/config';
import { randomInt } from 'node:crypto';
import { supabase } from '../config/supabase.js';
import { HttpError } from '../middleware/errorHandler.js';
import type {
  ConfirmVerificationInput,
  InitiateVerificationInput,
  VerificationChannel,
} from '../schemas/verification.schema.js';

const OTP_CODE_LENGTH = 6;
const OTP_TTL_SECONDS = 600; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;

const CHANNEL_TARGET: Record<VerificationChannel, { userColumn: string }> = {
  email: { userColumn: 'email' },
  whatsapp: { userColumn: 'whatsapp_number' },
};

const CHANNEL_VERIFIED_COLUMN: Record<VerificationChannel, string> = {
  email: 'email_verified',
  whatsapp: 'whatsapp_verified',
};

export class VerificationService {
  private generateCode(): string {
    const min = 10 ** (OTP_CODE_LENGTH - 1);
    const max = 10 ** OTP_CODE_LENGTH - 1;
    return randomInt(min, max).toString();
  }

  private mask(target: string, channel: VerificationChannel): string {
    if (channel === 'email') {
      const [local, domain] = target.split('@');
      const visible = local.slice(0, 2);
      return `${visible}***@${domain ?? ''}`;
    }
    const digits = target.replace(/\D/g, '');
    const tail = digits.slice(-3);
    const prefix = target.startsWith('+') ? '+' : '';
    return `${prefix}***${tail}`;
  }

  /**
   * Generates and stores an OTP for the user's contact on the given channel,
   * then hands the code to the matching delivery provider.
   */
  async initiate(userId: string, { channel }: InitiateVerificationInput) {
    const target = await this.getTarget(userId, channel);

    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();

    // Invalidate any previously issued, un-consumed codes for this channel so
    // only the most recent code is valid.
    const { error: invalidateError } = await supabase
      .from('verification_codes')
      .update({ consumed_at: expiresAt })
      .eq('user_id', userId)
      .eq('channel', channel)
      .is('consumed_at', null);

    if (invalidateError) {
      throw new HttpError(
        500,
        `Failed to prepare verification: ${invalidateError.message}`,
      );
    }

    const { error: insertError } = await supabase.from('verification_codes').insert({
      user_id: userId,
      channel,
      code,
      target,
      expires_at: expiresAt,
    });

    if (insertError) {
      throw new HttpError(
        500,
        `Failed to store verification code: ${insertError.message}`,
      );
    }

    try {
      if (channel === 'whatsapp') {
        await this.sendWhatsAppOtp(target, code);
      } else {
        await this.sendEmailOtp(target, code);
      }
    } catch (err) {
      // Roll back the stored code so a failed delivery can be retried cleanly.
      await supabase
        .from('verification_codes')
        .delete()
        .eq('user_id', userId)
        .eq('channel', channel)
        .eq('code', code);
      throw err;
    }

    return {
      channel,
      target: this.mask(target, channel),
      expiresAt,
      resendAfterSeconds: 30,
    };
  }

  /**
   * Validates a submitted code against the latest un-consumed, un-expired OTP
   * for the user + channel and marks the contact as verified on success.
   */
  async confirm(userId: string, { channel, code }: ConfirmVerificationInput) {
    const { data, error } = await supabase
      .from('verification_codes')
      .select('id, code, expires_at, consumed_at, attempts, target')
      .eq('user_id', userId)
      .eq('channel', channel)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Failed to verify code: ${error.message}`);
    }
    if (!data || data.consumed_at) {
      throw new HttpError(
        410,
        'No active verification code. Please request a new one.',
      );
    }

    if (new Date(data.expires_at).getTime() < Date.now()) {
      throw new HttpError(410, 'Verification code has expired. Please request a new one.');
    }

    if (data.attempts >= OTP_MAX_ATTEMPTS) {
      throw new HttpError(
        429,
        'Too many attempts. Please request a new verification code.',
      );
    }

    if (data.code !== code) {
      const { error: attemptsError } = await supabase
        .from('verification_codes')
        .update({ attempts: data.attempts + 1 })
        .eq('id', data.id);
      if (attemptsError) {
        throw new HttpError(500, `Failed to record attempt: ${attemptsError.message}`);
      }
      throw new HttpError(400, 'Incorrect verification code. Please try again.');
    }

    const now = new Date().toISOString();
    const verifiedColumn = CHANNEL_VERIFIED_COLUMN[channel];

    const { error: consumeError } = await supabase
      .from('verification_codes')
      .update({ consumed_at: now })
      .eq('id', data.id);
    if (consumeError) {
      throw new HttpError(500, `Failed to consume verification code: ${consumeError.message}`);
    }

    const { error: userError } = await supabase
      .from('users')
      .update({ [verifiedColumn]: true })
      .eq('id', userId);
    if (userError) {
      throw new HttpError(500, `Failed to mark contact verified: ${userError.message}`);
    }

    return {
      channel,
      target: this.mask(data.target, channel),
      verified: true,
    };
  }

  private async getTarget(userId: string, channel: VerificationChannel): Promise<string> {
    const { userColumn } = CHANNEL_TARGET[channel];

    const { data, error } = await supabase
      .from('users')
      .select('email, whatsapp_number')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Failed to load contact details: ${error.message}`);
    }
    if (!data) {
      throw new HttpError(404, 'User record not found');
    }

    const row = data as { email?: string | null; whatsapp_number?: string | null };
    const target = row[userColumn as 'email' | 'whatsapp_number'];
    if (!target) {
      throw new HttpError(
        409,
        `No ${channel === 'email' ? 'email' : 'WhatsApp number'} is set on your account.`,
      );
    }
    return target;
  }

  // ---------- Delivery providers ----------

  private async sendWhatsAppOtp(phone: string, code: string): Promise<void> {
    const apiKey = process.env.TERMII_API_KEY;
    const baseUrl = process.env.TERMII_BASE_URL ?? 'https://api.ng.termii.com';
    const senderId = process.env.TERMII_SENDER_ID ?? 'RoommateNG';

    if (!apiKey) {
      throw new HttpError(
        503,
        'WhatsApp verification is not configured. Missing TERMII_API_KEY.',
      );
    }

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/sms/otp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          message_type: 'NUMERIC',
          to: phone,
          from: senderId,
          channel: 'whatsapp',
          pin_attempts: OTP_MAX_ATTEMPTS,
          pin_time_to_live: OTP_TTL_SECONDS / 60,
          pin_length: OTP_CODE_LENGTH,
        }),
      });
    } catch (err) {
      throw new HttpError(502, `Failed to reach WhatsApp provider: ${String(err)}`);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new HttpError(502, `WhatsApp provider error (${res.status}): ${body}`);
    }
  }

  private async sendEmailOtp(email: string, code: string): Promise<void> {
    const provider = process.env.EMAIL_PROVIDER ?? 'resend';
    if (provider === 'sendgrid') {
      await this.sendViaSendGrid(email, code);
      return;
    }
    await this.sendViaResend(email, code);
  }

  private async sendViaResend(email: string, code: string): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM ?? 'Roommate NG <no-reply@roommateng.com>';

    if (!apiKey) {
      throw new HttpError(
        503,
        'Email verification is not configured. Missing RESEND_API_KEY.',
      );
    }

    let res: Response;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: 'Your verification code',
          text: `Your Roommate NG verification code is ${code}. It expires in 10 minutes.`,
          html: `<p>Your Roommate NG verification code is</p><p style="font-size:24px;letter-spacing:4px;font-weight:700">${code}</p><p>It expires in 10 minutes. If you did not request this, you can safely ignore this email.</p>`,
        }),
      });
    } catch (err) {
      throw new HttpError(502, `Failed to reach email provider: ${String(err)}`);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new HttpError(502, `Email provider error (${res.status}): ${body}`);
    }
  }

  private async sendViaSendGrid(email: string, code: string): Promise<void> {
    const apiKey = process.env.SENDGRID_API_KEY;
    const from = process.env.EMAIL_FROM ?? 'no-reply@roommateng.com';

    if (!apiKey) {
      throw new HttpError(
        503,
        'Email verification is not configured. Missing SENDGRID_API_KEY.',
      );
    }

    let res: Response;
    try {
      res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email }] }],
          from: { email: from },
          subject: 'Your verification code',
          content: [
            {
              type: 'text/plain',
              value: `Your Roommate NG verification code is ${code}. It expires in 10 minutes.`,
            },
          ],
        }),
      });
    } catch (err) {
      throw new HttpError(502, `Failed to reach email provider: ${String(err)}`);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new HttpError(502, `Email provider error (${res.status}): ${body}`);
    }
  }
}

export const verificationService = new VerificationService();