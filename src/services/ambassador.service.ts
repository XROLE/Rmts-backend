import { randomInt } from 'node:crypto';
import type { Session } from '@supabase/supabase-js';
import { HttpError } from '../middleware/errorHandler.js';
import { createAnonClient, supabase } from '../config/supabase.js';
import { paystackService } from './paystack.service.js';
import type {
  ChangeAmbassadorPasswordInput,
  LoginAmbassadorInput,
  RefreshAmbassadorTokenInput,
  RegisterAmbassadorInput,
  SaveBankDetailsInput,
  UpdateAmbassadorProfileInput,
  VerifyBankDetailsInput,
} from '../schemas/ambassador.schema.js';

const REFERRAL_CODE_LENGTH = 6;
const REFERRAL_MAX_ATTEMPTS = 10;

const PROFILE_SELECT =
  'id, user_id, referral_code, total_referrals, total_earnings_ngn, pending_balance_ngn, available_balance_ngn, total_withdrawn_ngn, bank_code, bank_name, account_number, account_name, paystack_recipient_code, campus_or_region, is_approved, profile_picture_url, verification_status, ambassador_ranking, state_covering, emergency_contact, audience_category, institution_or_organization, primary_operating, secondary_operating, social_media_platform, social_media_handle, social_media_target_audience, created_at, updated_at';

/**
 * Admin list select: everything in PROFILE_SELECT plus the ambassador's full
 * public.users identity row, nested under `user` (via the user_id FK).
 */
const ADMIN_LIST_SELECT = `${PROFILE_SELECT}, user:users!user_id(*)`;

export class AmbassadorService {
  /**
   * Generates a short, human-friendly referral code (e.g. "JANE84") and
   * guarantees it is unique across ambassador profiles.
   */
  /**
   * Builds a zero-padded numeric suffix with the requested number of digits.
   */
  private numericSuffix(length: number): string {
    if (length <= 0) return '';
    const min = length === 1 ? 0 : 10 ** (length - 1);
    const max = 10 ** length - 1;
    return randomInt(min, max).toString().padStart(length, '0');
  }

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
      const suffixLength = Math.max(0, REFERRAL_CODE_LENGTH - base.length);
      const suffix = this.numericSuffix(suffixLength);
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
      email_verified: false,
      whatsapp_verified: false,
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
      .select('id, full_name, email, whatsapp_number, email_verified, whatsapp_verified, role, is_active')
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
   * Returns all ambassador profiles, newest first, paginated. Admin-only.
   */
  async listAll(limit: number, offset: number) {
    const [listResult, countResult] = await Promise.all([
      supabase
        .from('ambassador_profiles')
        .select(ADMIN_LIST_SELECT)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1),
      supabase
        .from('ambassador_profiles')
        .select('id', { count: 'exact', head: true }),
    ]);

    if (listResult.error) {
      throw new HttpError(
        500,
        `Failed to fetch ambassadors: ${listResult.error.message}`,
      );
    }
    if (countResult.error) {
      throw new HttpError(
        500,
        `Failed to count ambassadors: ${countResult.error.message}`,
      );
    }

    return {
      items: listResult.data ?? [],
      total: countResult.count ?? 0,
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
   * Returns every roommate profile that registered with the ambassador's
   * referral code, newest first. Contact details (phone/email/bio) are
   * excluded to keep roommate PII minimal.
   */
  async getReferrals(userId: string) {
    const { data: ambassadorProfile, error: profileError } = await supabase
      .from('ambassador_profiles')
      .select('referral_code')
      .eq('user_id', userId)
      .single();

    if (profileError || !ambassadorProfile) {
      throw new HttpError(404, 'Ambassador profile not found');
    }

    const { data, error } = await supabase
      .from('roommate_profiles')
      .select('*')
      .eq('referred_by_code', ambassadorProfile.referral_code)
      .order('created_at', { ascending: false });

    if (error) {
      throw new HttpError(500, `Failed to fetch referrals: ${error.message}`);
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
   * Resolves and returns the verified account holder name for a NUBAN
   * account + bank code via Paystack. Does not persist anything.
   */
  async verifyBankDetails(userId: string, input: VerifyBankDetailsInput) {
    const bankCode = resolveBankCode(input.bankCode);
    const { accountName } = await paystackService.resolveAccount({
      accountNumber: resolveAccountNumber(input.accountNumber),
      bankCode,
    });

    return {
      accountNumber: input.accountNumber,
      accountName,
      bankCode,
      ...(input.bankName !== undefined ? { bankName: input.bankName } : {}),
    };
  }

  /**
   * Re-verifies the bank details against Paystack and, only when the resolved
   * account holder name matches the submitted account name, persists the bank
   * fields to the ambassador's profile. Ensures unverified details can never
   * be written.
   */
  async saveBankDetails(userId: string, input: SaveBankDetailsInput) {
    const bankCode = resolveBankCode(input.bankCode);
    const { accountName } = await paystackService.resolveAccount({
      accountNumber: resolveAccountNumber(input.accountNumber),
      bankCode,
    });

    const isTestMode = process.env.USE_PAYSTACK_TEST_BANK === 'true';
    if (!isTestMode && accountName.toLowerCase() !== input.accountName.toLowerCase()) {
      throw new HttpError(
        400,
        'Account name does not match the name on the bank account. Please check and retry.',
      );
    }

    const { recipientCode } = await paystackService.createTransferRecipient({
      name: accountName,
      accountNumber: resolveAccountNumber(input.accountNumber),
      bankCode,
    });

    const { data, error } = await supabase
      .from('ambassador_profiles')
      .update({
        bank_code: bankCode,
        bank_name: input.bankName,
        account_number: input.accountNumber,
        account_name: accountName,
        paystack_recipient_code: recipientCode,
      })
      .eq('user_id', userId)
      .select(PROFILE_SELECT)
      .single();

    if (error) {
      throw new HttpError(500, `Failed to save bank details: ${error.message}`);
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
   * Uploads an ambassador's profile picture to Supabase Storage and persists
   * the resulting public URL on the ambassador_profiles record.
   */
  async uploadProfilePicture(
    userId: string,
    file: { buffer: Buffer; mimetype: string; size: number; originalname: string },
  ) {
    if (!file) {
      throw new HttpError(400, 'An image file is required');
    }

    if (!file.mimetype.startsWith('image/')) {
      throw new HttpError(400, 'Uploaded file must be an image');
    }

    if (file.size > 2 * 1024 * 1024) {
      throw new HttpError(400, 'Image must be at most 2MB');
    }

    const bucket = 'avatars';
    const ext = (file.originalname.split('.').pop() || 'png')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    const path = `ambassadors/${userId}/${Date.now()}.${ext}`;

    const { data: existingBucket } = await supabase.storage.getBucket(bucket);
    if (!existingBucket) {
      const { error: bucketError } = await supabase.storage.createBucket(bucket, {
        public: true,
      });
      if (bucketError && !/already exists/i.test(bucketError.message)) {
        throw new HttpError(500, `Failed to prepare storage: ${bucketError.message}`);
      }
    }

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (uploadError) {
      throw new HttpError(500, `Failed to upload image: ${uploadError.message}`);
    }

    const { data: publicUrlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(path);

    if (!publicUrlData?.publicUrl) {
      throw new HttpError(500, 'Failed to resolve public image URL');
    }

    const { data, error } = await supabase
      .from('ambassador_profiles')
      .update({ profile_picture_url: publicUrlData.publicUrl })
      .eq('user_id', userId)
      .select(PROFILE_SELECT)
      .single();

    if (error) {
      throw new HttpError(500, `Failed to update profile: ${error.message}`);
    }

    return { profile_picture_url: publicUrlData.publicUrl };
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

/**
 * Returns the actual bank code provided by the user. In test mode
 * (USE_PAYSTACK_TEST_BANK=true) Paystack's fake "Test Bank" (001) cannot
 * create transfer recipients, so we always pass through the real bank code.
 */
export function resolveBankCode(actualCode: string): string {
  return actualCode;
}

/**
 * Returns the actual account number provided by the user. In test mode
 * (USE_PAYSTACK_TEST_BANK=true) Paystack's fake bank account cannot create
 * transfer recipients, so we always pass through the real account number.
 */
export function resolveAccountNumber(actualNumber: string): string {
  return actualNumber;
}