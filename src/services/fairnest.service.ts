import { HttpError } from '../middleware/errorHandler.js';
import { supabase } from '../config/supabase.js';
import { whatsappLifecycleService } from './whatsappLifecycle.service.js';

export interface CreateFairnestPayload {
  fullName: string;
  gender: 'male' | 'female' | 'no_preference';
  occupation: 'student' | 'nysc' | 'working_professional' | 'self_employed' | 'job_seeker';
  email: string;
  phoneNumber: string;
  maritalStatus?: 'single' | 'married' | 'divorced' | 'prefer_not_to_say';
  propertyType: 'apartment' | 'house' | 'studio' | 'duplex' | 'bungalow' | 'self_contained';
  preferredLocations: string[];
  budgetMin: number;
  budgetMax: number;
  personalBio?: string;
  agreedToTerms: true;
}

const RENT_SELECT =
  'id, full_name, phone_number, email, gender, occupation, marital_status, property_type, preferred_locations, budget_min, budget_max, personal_bio, referred_by_code, status, is_active, agreed_to_terms, created_at, updated_at';

const BUY_SELECT = RENT_SELECT;

export class FairnestService {
  async createRent(payload: CreateFairnestPayload, referralCode?: string) {
    return this.create('fairnest_rent_profiles', payload, referralCode);
  }

  async createBuy(payload: CreateFairnestPayload, referralCode?: string) {
    return this.create('fairnest_buy_profiles', payload, referralCode);
  }

  private async create(
    table: 'fairnest_rent_profiles' | 'fairnest_buy_profiles',
    payload: CreateFairnestPayload,
    referralCode?: string,
  ) {
    const {
      fullName,
      phoneNumber,
      email,
      gender,
      occupation,
      maritalStatus = 'single',
      propertyType,
      preferredLocations,
      budgetMin,
      budgetMax,
      personalBio,
      agreedToTerms,
    } = payload;

    const ambassador = referralCode
      ? await this.findAmbassadorByReferralCode(referralCode)
      : null;

    const { data, error: insertError } = await supabase
      .from(table)
      .insert({
        full_name: fullName,
        phone_number: phoneNumber,
        email,
        gender,
        occupation,
        marital_status: maritalStatus,
        property_type: propertyType,
        preferred_locations: Array.from(
          new Set(preferredLocations.map((l) => l.trim()).filter(Boolean)),
        ),
        budget_min: budgetMin,
        budget_max: budgetMax,
        personal_bio: personalBio,
        agreed_to_terms: agreedToTerms,
        agreed_at: new Date().toISOString(),
        referred_by_code: ambassador ? ambassador.referral_code : undefined,
      })
      .select(RENT_SELECT)
      .single();

    if (insertError) {
      throw new HttpError(500, `Failed to create FairNest request: ${insertError.message}`);
    }

    if (ambassador) {
      await this.incrementReferralCount(ambassador);
    }

    if (table === 'fairnest_rent_profiles') {
      void whatsappLifecycleService
        .sendFairnestRentWelcome({
          fullName,
          phoneNumber,
          propertyType,
          preferredLocations,
          budgetMin,
          budgetMax,
        })
        .catch((err) =>
          console.error('[fairnest] rent welcome message failed:', err),
        );
    }

    return data;
  }

  async listRent(limit: number, offset: number) {
    return this.list('fairnest_rent_profiles', RENT_SELECT, limit, offset);
  }

  async listBuy(limit: number, offset: number) {
    return this.list('fairnest_buy_profiles', BUY_SELECT, limit, offset);
  }

  private async list(
    table: 'fairnest_rent_profiles' | 'fairnest_buy_profiles',
    select: string,
    limit: number,
    offset: number,
  ) {
    const [listResult, countResult] = await Promise.all([
      supabase
        .from(table)
        .select(select)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1),
      supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null),
    ]);

    if (listResult.error) {
      throw new HttpError(500, `Failed to fetch FairNest requests: ${listResult.error.message}`);
    }
    if (countResult.error) {
      throw new HttpError(500, `Failed to count FairNest requests: ${countResult.error.message}`);
    }

    return {
      items: listResult.data ?? [],
      total: countResult.count ?? 0,
    };
  }

  private async findAmbassadorByReferralCode(referralCode: string) {
    const { data, error } = await supabase
      .from('ambassador_profiles')
      .select('id, referral_code, total_referrals')
      .eq('referral_code', referralCode.toUpperCase())
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Failed to validate referral code: ${error.message}`);
    }

    return data;
  }

  private async incrementReferralCount(ambassador: {
    id: string;
    total_referrals: number;
  }) {
    const { error } = await supabase
      .from('ambassador_profiles')
      .update({ total_referrals: ambassador.total_referrals + 1 })
      .eq('id', ambassador.id);

    if (error) {
      console.error('Failed to increment referral count:', error.message);
    }
  }
}

export const fairnestService = new FairnestService();
