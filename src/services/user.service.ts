import { HttpError } from '../middleware/errorHandler.js';
import { supabase } from '../config/supabase.js';

const USER_SELECT = 'id, full_name, email, role, is_active, deleted_at, created_at, updated_at';

export class UserService {
  /**
   * Soft-deletes (deactivates) a user by id. Sets is_active=false + deleted_at
   * on public.users, cascades to any linked ambassador_profiles (deleted_at +
   * is_approved=false) and roommate_profiles (is_active=false), and bans the
   * Supabase auth user so the account can no longer sign in.
   *
   * Guards:
   *  - a super admin cannot deactivate their own account (lockout prevention);
   *  - super admin accounts cannot be deactivated through this endpoint.
   *
   * `actorId` is the id of the authenticated super admin performing the action.
   */
  async deactivateUser(userId: string, actorId: string) {
    if (userId === actorId) {
      throw new HttpError(403, 'You cannot deactivate your own account');
    }

    const { data: existing, error: fetchError } = await supabase
      .from('users')
      .select('id, role')
      .eq('id', userId)
      .maybeSingle();

    if (fetchError) {
      throw new HttpError(500, `Failed to fetch user: ${fetchError.message}`);
    }
    if (!existing) {
      throw new HttpError(404, 'User not found');
    }
    if (existing.role === 'super_admin') {
      throw new HttpError(403, 'Super admin accounts cannot be deactivated');
    }

    const now = new Date().toISOString();

    const { data, error: userError } = await supabase
      .from('users')
      .update({ is_active: false, deleted_at: now })
      .eq('id', userId)
      .select(USER_SELECT)
      .single();

    if (userError) {
      throw new HttpError(500, `Failed to deactivate user: ${userError.message}`);
    }

    // Cascade to any linked ambassador profile.
    const { error: ambassadorError } = await supabase
      .from('ambassador_profiles')
      .update({ is_approved: false, deleted_at: now })
      .eq('user_id', userId);

    if (ambassadorError) {
      throw new HttpError(
        500,
        `Failed to deactivate ambassador profile: ${ambassadorError.message}`,
      );
    }

    // Take any linked roommate profile out of the matching pool.
    const { error: roommateError } = await supabase
      .from('roommate_profiles')
      .update({ is_active: false })
      .eq('user_id', userId);

    if (roommateError) {
      throw new HttpError(
        500,
        `Failed to deactivate roommate profile: ${roommateError.message}`,
      );
    }

    await this.banAuthUser(userId);

    return { user: data, deactivatedAt: now };
  }

  /**
   * Bans a Supabase auth user (effectively disabling sign-in) without deleting
   * the auth record. Uses a very long ban duration so the account stays locked
   * until explicitly unbanned.
   */
  private async banAuthUser(userId: string) {
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      ban_duration: '876000h',
    });
    if (error) {
      throw new HttpError(
        500,
        `Failed to disable auth sign-in: ${error.message}`,
      );
    }
  }
}

export const userService = new UserService();
