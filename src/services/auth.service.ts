import { randomInt } from 'node:crypto';
import type { Session } from '@supabase/supabase-js';
import { HttpError } from '../middleware/errorHandler.js';
import { createAnonClient, supabase } from '../config/supabase.js';
import { emailService } from './email.service.js';
import type {
  ForgotPasswordInput,
  RefreshTokenInput,
  ResetPasswordInput,
} from '../schemas/auth.schema.js';

const PASSWORD_RESET_TTL_SECONDS = 600; // 10 minutes
const PASSWORD_RESET_MAX_ATTEMPTS = 5;
const RESET_CHANNEL = 'password_reset';

export class AuthService {
  /**
   * Exchanges a refresh token for a fresh session. Role-agnostic: can refresh
   * an ambassador, admin, or super admin session. Throws 401 when invalid.
   */
  async refreshSession({ refreshToken }: RefreshTokenInput) {
    const anon = createAnonClient();
    const { data, error } = await anon.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      throw new HttpError(401, 'Invalid or expired refresh token');
    }

    return {
      session: this.formatSession(data.session),
    };
  }

  /**
   * Initiates a password reset for the email address. Always resolves
   * successfully (even when no account exists) so callers can't tell which
   * emails are registered. When an account exists, issues a 4-digit OTP into
   * verification_codes and emails it to the address.
   */
  async forgotPassword({ email }: ForgotPasswordInput) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.findUserByEmail(normalizedEmail);

    if (!user) {
      return { target: this.maskEmail(normalizedEmail), resendAfterSeconds: 30 };
    }

    const code = randomInt(0, 10000).toString().padStart(4, '0');
    const expiresAt = new Date(
      Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000,
    ).toISOString();

    const { error: invalidateError } = await supabase
      .from('verification_codes')
      .update({ consumed_at: expiresAt })
      .eq('user_id', user.id)
      .eq('channel', RESET_CHANNEL)
      .is('consumed_at', null);

    if (invalidateError) {
      throw new HttpError(
        500,
        `Failed to prepare password reset: ${invalidateError.message}`,
      );
    }

    const { error: insertError } = await supabase.from('verification_codes').insert({
      user_id: user.id,
      channel: RESET_CHANNEL,
      code,
      target: normalizedEmail,
      expires_at: expiresAt,
    });

    if (insertError) {
      throw new HttpError(
        500,
        `Failed to store password reset code: ${insertError.message}`,
      );
    }

    try {
      await emailService.sendPasswordResetCode({ to: normalizedEmail, code });
    } catch (err) {
      await this.consumeUndeliveredCodes(user.id);
      throw new HttpError(
        500,
        `Failed to send password reset email: ${err instanceof Error ? err.message : err}`,
      );
    }

    return {
      target: this.maskEmail(normalizedEmail),
      expiresAt,
      resendAfterSeconds: 30,
      provider: 'email',
    };
  }

  /**
   * Resets the password using the emailed 4-digit OTP. Validates the latest
   * un-consumed, un-expired code for the account, consumes it on success, and
   * updates the password via Supabase Auth so it is hashed correctly.
   */
  async resetPassword({ email, code, newPassword }: ResetPasswordInput) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.findUserByEmail(normalizedEmail);

    if (!user) {
      throw new HttpError(
        410,
        'No active reset code. Please request a new one.',
      );
    }

    const { data, error } = await supabase
      .from('verification_codes')
      .select('id, code, expires_at, consumed_at, attempts')
      .eq('user_id', user.id)
      .eq('channel', RESET_CHANNEL)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Failed to verify reset code: ${error.message}`);
    }
    if (!data || data.consumed_at) {
      throw new HttpError(
        410,
        'No active reset code. Please request a new one.',
      );
    }

    if (new Date(data.expires_at).getTime() < Date.now()) {
      throw new HttpError(410, 'Reset code has expired. Please request a new one.');
    }

    if (data.attempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
      throw new HttpError(
        429,
        'Too many attempts. Please request a new reset code.',
      );
    }

    if (data.code !== code) {
      const { error: attemptsError } = await supabase
        .from('verification_codes')
        .update({ attempts: data.attempts + 1 })
        .eq('id', data.id);
      if (attemptsError) {
        throw new HttpError(
          500,
          `Failed to record attempt: ${attemptsError.message}`,
        );
      }
      throw new HttpError(400, 'Incorrect reset code. Please try again.');
    }

    const { error: consumeError } = await supabase
      .from('verification_codes')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', data.id);
    if (consumeError) {
      throw new HttpError(
        500,
        `Failed to consume reset code: ${consumeError.message}`,
      );
    }

    const { error: passwordError } = await supabase.auth.admin.updateUserById(
      user.id,
      { password: newPassword },
    );
    if (passwordError) {
      throw new HttpError(
        500,
        `Failed to reset password: ${passwordError.message}`,
      );
    }

    return { reset: true };
  }

  private async findUserByEmail(email: string) {
    const { data, error } = await supabase
      .from('users')
      .select('id, email')
      .ilike('email', email)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Failed to look up account: ${error.message}`);
    }
    return data ?? null;
  }

  private async consumeUndeliveredCodes(userId: string) {
    const { error } = await supabase
      .from('verification_codes')
      .update({ consumed_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('channel', RESET_CHANNEL)
      .is('consumed_at', null);
    if (error) {
      console.error(
        '[auth] failed to consume undelivered reset code:',
        error.message,
      );
    }
  }

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    const visible = local.slice(0, 2);
    return `${visible}***@${domain ?? ''}`;
  }

  formatSession(session: Session) {
    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at,
      user: {
        id: session.user.id,
        email: session.user.email,
      },
    };
  }
}

export const authService = new AuthService();