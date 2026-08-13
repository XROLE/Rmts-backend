import 'dotenv/config';
import { supabase } from '../config/supabase.js';
import { HttpError } from '../middleware/errorHandler.js';
import type {
  ConfirmVerificationInput,
  InitiateVerificationInput,
  VerificationChannel,
} from '../schemas/verification.schema.js';

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
   * Stores a fixed mock OTP (7530) for the user's contact on the given channel
   * and returns it. No external delivery provider is used.
   */
  async initiate(userId: string, { channel }: InitiateVerificationInput) {
    const target = await this.getTarget(userId, channel);

    const code = '7530';
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

    return {
      channel,
      target: this.mask(target, channel),
      expiresAt,
      resendAfterSeconds: 30,
      code,
      provider: 'mock',
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
}

export const verificationService = new VerificationService();