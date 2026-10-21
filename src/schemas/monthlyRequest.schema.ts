import { z } from 'zod';
import { SUPPORTED_PHONE_REGEX } from '../utils/normalizePhone.js';

const GENDER = z.enum(['male', 'female', 'no_preference']);

/** Public web submission of a monthly shared-apartment request. */
export const createMonthlyRequestSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required').max(100),
    phoneNumber: z.string().regex(
      SUPPORTED_PHONE_REGEX,
      'Phone number must be a valid Nigerian or UK phone number',
    ),
    email: z.string().email().optional(),
    gender: GENDER,
    state: z.string().min(1, 'State is required').max(100),
    preferredLocation: z
      .string()
      .min(1, 'Preferred location is required')
      .max(100),
    budgetMin: z.number().min(0, 'Minimum budget must be 0 or greater'),
    budgetMax: z.number().min(0, 'Maximum budget must be 0 or greater'),
    moveInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: 'Move-in date must be a YYYY-MM-DD date',
    }),
  }).refine(
    (data) => data.budgetMax >= data.budgetMin,
    {
      message: 'budgetMax must be greater than or equal to budgetMin',
      path: ['budgetMax'],
    },
  ),
});

/**
 * Admin trigger to notify everyone who requested a monthly shared space in a
 * given state + area. Mirrors the roommate "find candidates" filter but only
 * selects stored requests (no matching).
 */
export const notifyMonthlyRequestSchema = z.object({
  body: z.object({
    state: z.string().min(1, 'State is required').max(100),
    preferredLocation: z
      .string()
      .min(1, 'Preferred location is required')
      .max(100),
  }),
});

export type CreateMonthlyRequestInput = z.infer<
  typeof createMonthlyRequestSchema
>['body'];

export type NotifyMonthlyRequestInput = z.infer<
  typeof notifyMonthlyRequestSchema
>['body'];
