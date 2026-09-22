import type { Session } from '@supabase/supabase-js';
import { HttpError } from '../middleware/errorHandler.js';
import { createAnonClient } from '../config/supabase.js';
import type { RefreshTokenInput } from '../schemas/auth.schema.js';

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