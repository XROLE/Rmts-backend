import { randomInt } from 'node:crypto';
import type { Session } from '@supabase/supabase-js';
import { HttpError } from '../middleware/errorHandler.js';
import { createAnonClient, supabase } from '../config/supabase.js';
import type {
  ChangeAmbassadorPasswordInput,
  LoginAmbassadorInput,
  RefreshAmbassadorTokenInput,
  RegisterAmbassadorInput,
  UpdateAmbassadorProfileInput,
} from '../schemas/ambassador.schema.js';

const REFERRAL_CODE_LENGTH = 6;
const REFERRAL_MAX_ATTEMPTS = 10;

const PROFILE_SELECT =
  'id, user_id, referral_code, total_referrals, total_earnings_ngn, pending_balance_ngn, bank_code, bank_name, account_number, account_name, campus_or_region, is_approved, profile_picture_url, verification_status, ambassador_ranking, state_covering, emergency_contact, audience_category, institution_or_organization, primary_operating, secondary_operating, social_media_platform, social_media_handle, social_media_target_audience, created_at, updated_at';

export class AmbassadorService {
  /**
   * Generates a short, human-friendly referral code (e.g. "JANE84") and
   * guarantees it is unique across ambassador profiles.
   */
  private async generateReferralCode(fullName: string): Promise<string> {
    const initials = fullName
      .trim()
      .replace(/\s+/g, ' ')
      .split(' ')
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('');

    for (let attempt = 0; attempt < REFERRAL_MAX_ATTEMPTS; attempt++) {
      const base = initials || 'AMBA';
      const suffix = randomInt(10, 99).toString();
      const candidate = `${base}${suffix}`.slice(0, REFERRAL_CODE_LENGTH);

      const { data, error } = await supabase
        .from('ambassador_profiles')
        .select('id')
        .eq('referral_code', candidate)
        .maybeSingle();

      if (error) {
        throw new HttpError(500, `Failed to generate referral code: ${error.message}`);
      }

      if (!data) return candidate;
    }

    throw new HttpError(500, 'Unable to generate a unique referral code. Please retry.');
  }

  /**
   * Registers a new ambassador:
   *  1. Creates the Supabase auth user (owns credentials + JWT identity).
   *  2. Mirrors identity into public.users with role 'ambassador'.
   *  3. Creates the ambassador profile holding the referral code.
   *  4. Auto-logs-in so a session token is returned immediately.
   */
  async register(payload: RegisterAmbassadorInput) {
    const { fullName, email, whatsappNumber, password } = payload;
    const referralCode = await this.generateReferralCode(fullName);

    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        whatsapp_number: whatsappNumber,
        role: 'ambassador',
      },
    });

    if (authError) {
      throw new HttpError(400, this.authErrorMessage(authError.message));
    }

    const userId = authUser.user!.id;

    const { error: userError } = await supabase.from('users').insert({
      id: userId,
      full_name: fullName,
      email,
      whatsapp_number: whatsappNumber,
      role: 'ambassador',
      is_active: true,
    });

    if (userError) {
      throw new HttpError(500, `Failed to create user record: ${userError.message}`);
    }

    const { data: ambassadorProfile, error: profileError } = await supabase
      .from('ambassador_profiles')
      .insert({
        user_id: userId,
        referral_code: referralCode,
      })
      .select(PROFILE_SELECT)
      .single();

    if (profileError) {
      throw new HttpError(
        500,
        `Failed to create ambassador profile: ${profileError.message}`,
      );
    }

    const session = await this.obtainSession({ email, password });

    const user = {
      id: userId,
      full_name: fullName,
      email,
      whatsapp_number: whatsappNumber,
      role: 'ambassador' as const,
      is_active: true,
    };

    return {
      session: this.formatSession(session),
      user,
      ambassadorProfile,
    };
  }

  /**
   * Authenticates an ambassador and returns the session plus their profile.
   * Uses a dedicated anon-key client so the shared service-role client's
   * auth state is never downgraded to the 'authenticated' role.
   */
  async login({ email, password }: LoginAmbassadorInput) {
    const anon = createAnonClient();
    const { data: { session }, error: signInError } =
      await anon.auth.signInWithPassword({ email, password });

    if (signInError || !session) {
      throw new HttpError(401, 'Invalid email or password');
    }

    const userId = session.user.id;

    const { data: user, error: userError } = await anon
      .from('users')
      .select('id, full_name, email, whatsapp_number, role, is_active')
      .eq('id', userId)
      .single();

    if (userError) {
      throw new HttpError(404, 'User record not found');
    }

    const { data: ambassadorProfile, error: profileError } = await anon
      .from('ambassador_profiles')
      .select(
        PROFILE_SELECT,
      )
      .eq('user_id', userId)
      .single();

    if (profileError) {
      throw new HttpError(404, 'Ambassador profile not found');
    }

    return {
      session: this.formatSession(session),
      user,
      ambassadorProfile,
    };
  }

  /**
   * Returns the ambassador's own profile by user_id.
   */
  async getProfile(userId: string) {
    const { data, error } = await supabase
      .from('ambassador_profiles')
      .select(PROFILE_SELECT)
      .eq('user_id', userId)
      .single();

    if (error) {
      throw new HttpError(404, 'Ambassador profile not found');
    }
    return data;
  }

  /**
   * Updates the ambassador's own profile + bank details. Verification status
   * and ambassador ranking are excluded so an ambassador cannot escalate
   * themselves; those remain admin-managed.
   */
  async updateProfile(userId: string, payload: UpdateAmbassadorProfileInput) {
    const {
      fullName,
      whatsappNumber,
      profilePictureUrl,
      stateCovering,
      emergencyContact,
      audienceCategory,
      institutionOrOrganization,
      primaryOperating,
      secondaryOperating,
      socialMediaPlatform,
      socialMediaHandle,
      socialMediaTargetAudience,
      bankCode,
      bankName,
      accountNumber,
      accountName,
    } = payload;

    const profileUpdate: Record<string, unknown> = {};

    if (profilePictureUrl !== undefined) profileUpdate.profile_picture_url = profilePictureUrl;
    if (stateCovering !== undefined) profileUpdate.state_covering = stateCovering;
    if (emergencyContact !== undefined) profileUpdate.emergency_contact = emergencyContact;
    if (audienceCategory !== undefined) profileUpdate.audience_category = audienceCategory;
    if (institutionOrOrganization !== undefined) profileUpdate.institution_or_organization = institutionOrOrganization;
    if (primaryOperating !== undefined) profileUpdate.primary_operating = primaryOperating;
    if (secondaryOperating !== undefined) profileUpdate.secondary_operating = secondaryOperating;
    if (socialMediaPlatform !== undefined) profileUpdate.social_media_platform = socialMediaPlatform;
    if (socialMediaHandle !== undefined) profileUpdate.social_media_handle = socialMediaHandle;
    if (socialMediaTargetAudience !== undefined) profileUpdate.social_media_target_audience = socialMediaTargetAudience;
    if (bankCode !== undefined) profileUpdate.bank_code = bankCode;
    if (bankName !== undefined) profileUpdate.bank_name = bankName;
    if (accountNumber !== undefined) profileUpdate.account_number = accountNumber;
    if (accountName !== undefined) profileUpdate.account_name = accountName;

    const { data, error } = await supabase
      .from('ambassador_profiles')
      .update(profileUpdate)
      .eq('user_id', userId)
      .select(PROFILE_SELECT)
      .single();

    if (error) {
      throw new HttpError(500, `Failed to update profile: ${error.message}`);
    }

    if (fullName !== undefined || whatsappNumber !== undefined) {
      const userUpdate: Record<string, unknown> = {};
      if (fullName !== undefined) userUpdate.full_name = fullName;
      if (whatsappNumber !== undefined) userUpdate.whatsapp_number = whatsappNumber;

      const { error: userError } = await supabase
        .from('users')
        .update(userUpdate)
        .eq('id', userId);

      if (userError) {
        throw new HttpError(500, `Failed to update user: ${userError.message}`);
      }

      if (fullName !== undefined) {
        const { error: metaError } = await supabase.auth.admin.updateUserById(
          userId,
          { user_metadata: { full_name: fullName } },
        );
        if (metaError) {
          throw new HttpError(500, `Failed to update user metadata: ${metaError.message}`);
        }
      }
    }

    return data;
  }

  /**
   * Changes an ambassador's password. Verifies the current password first,
   * then updates via Supabase Auth so the password is hashed correctly.
   */
  async changePassword(
    userId: string,
    email: string,
    { currentPassword, newPassword }: ChangeAmbassadorPasswordInput,
  ) {
    const anon = createAnonClient();
    const { error: signInError } = await anon.auth.signInWithPassword({
      email,
      password: currentPassword,
    });

    if (signInError) {
      throw new HttpError(400, 'Current password is incorrect');
    }

    const { error } = await anon.auth.updateUser({ password: newPassword });
    if (error) {
      throw new HttpError(
        500,
        `Failed to change password: ${error.message}`,
      );
    }

    return { updated: true };
  }

  /**
   * Exchanges a refresh token for a fresh session. Useful when an access
   * token can no longer be verified (e.g. after a project JWT key rotation).
   */
  async refreshSession({ refreshToken }: RefreshAmbassadorTokenInput) {
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
   * Returns a session for the newly-registered user by signing in via an
   * isolated anon-key client (never the service-role client).
   */
  private async obtainSession({
    email,
    password,
  }: {
    email: string;
    password: string;
  }): Promise<Session> {
    const anon = createAnonClient();
    const { data: { session }, error } = await anon.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !session) {
      throw new HttpError(401, 'Unable to create session after registration');
    }

    return session;
  }

  private formatSession(session: Session) {
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

  private authErrorMessage(message: string): string {
    if (message.toLowerCase().includes('already registered')) {
      return 'An account with this email already exists. Please log in.';
    }
    return `Registration failed: ${message}`;
  }
}

export const ambassadorService = new AmbassadorService();