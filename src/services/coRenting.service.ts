import { supabase } from '../config/supabase.js';
import { HttpError } from '../middleware/errorHandler.js';
import type {
  CoRentingMatchingStatus,
  GetCoRentersInput,
  SetCoRentingInterestInput,
} from '../schemas/coRenting.schema.js';

const CO_RENTING_SELECT =
  'id, user_id, full_name, phone_number, email, gender, age_range, state, marital_status, religion, preferred_locations, budget_min, budget_max, expected_move_in_date, occupation, smoking_habit, allows_pets, sleep_habit, personal_bio, tribe, ideal_flatmate_description, user_bio, is_co_renting, co_renting_matching_status, status, is_active, referred_by_code, created_at, updated_at';

export class CoRentingService {
  /**
   * Records a user's co-renting interest on their own roommate profile, found
   * via the authenticated user id (roommate_profiles.user_id). Each submission
   * resets the matching status to 'active-search' so a fresh expression of
   * interest starts at the beginning of the matching lifecycle.
   */
  async setInterest(userId: string, payload: SetCoRentingInterestInput) {
    const { data: existing, error: findError } = await supabase
      .from('roommate_profiles')
      .select('id')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .maybeSingle();

    if (findError) {
      throw new HttpError(500, `Failed to find roommate profile: ${findError.message}`);
    }
    if (!existing) {
      throw new HttpError(404, 'No roommate profile found for this user');
    }

    const { data, error } = await supabase
      .from('roommate_profiles')
      .update({
        is_co_renting: payload.isCoRenting,
        tribe: payload.tribe.trim(),
        ideal_flatmate_description: payload.idealFlatmateDescription.trim(),
        user_bio: payload.userBio.trim(),
        co_renting_matching_status: 'active-search' as CoRentingMatchingStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select(CO_RENTING_SELECT)
      .single();

    if (error) {
      throw new HttpError(500, `Failed to save co-renting interest: ${error.message}`);
    }

    return data;
  }

  /**
   * Returns registered co-renters (is_co_renting = true), newest first,
   * paginated. Soft-deleted profiles are excluded. An optional matching
   * status filter narrows the directory.
   */
  async listCoRenters(filters: GetCoRentersInput) {
    const applyFilters = (q: any) => {
      q = q.eq('is_co_renting', true).is('deleted_at', null);
      if (filters.matchingStatus) {
        q = q.eq('co_renting_matching_status', filters.matchingStatus);
      }
      return q;
    };

    const [listResult, countResult] = await Promise.all([
      applyFilters(
        supabase.from('roommate_profiles').select(CO_RENTING_SELECT),
      )
        .order('created_at', { ascending: false })
        .range(filters.offset, filters.offset + filters.limit - 1),
      applyFilters(
        supabase
          .from('roommate_profiles')
          .select('id', { count: 'exact', head: true }),
      ),
    ]);

    if (listResult.error) {
      throw new HttpError(500, `Failed to fetch co-renters: ${listResult.error.message}`);
    }
    if (countResult.error) {
      throw new HttpError(500, `Failed to count co-renters: ${countResult.error.message}`);
    }

    return {
      items: listResult.data ?? [],
      total: countResult.count ?? 0,
    };
  }

  /**
   * Admin-only transition of a co-renter's matching status. The profile must
   * exist and be registered for co-renting.
   */
  async updateMatchingStatus(id: string, status: CoRentingMatchingStatus) {
    const { data: existing, error: findError } = await supabase
      .from('roommate_profiles')
      .select('id, is_co_renting, deleted_at')
      .eq('id', id)
      .maybeSingle();

    if (findError) {
      throw new HttpError(500, `Failed to find roommate profile: ${findError.message}`);
    }
    if (!existing || existing.deleted_at) {
      throw new HttpError(404, 'Roommate profile not found');
    }
    if (!existing.is_co_renting) {
      throw new HttpError(409, 'Profile is not registered for co-renting');
    }

    const { data, error } = await supabase
      .from('roommate_profiles')
      .update({
        co_renting_matching_status: status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select(CO_RENTING_SELECT)
      .single();

    if (error) {
      throw new HttpError(
        500,
        `Failed to update co-renting matching status: ${error.message}`,
      );
    }

    return data;
  }
}

export const coRentingService = new CoRentingService();
