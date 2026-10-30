import { z } from 'zod';
import { SUPPORTED_PHONE_REGEX } from '../utils/normalizePhone.js';

const GENDER = z.enum(['male', 'female', 'no_preference']);
const MARITAL_STATUS = z.enum([
  'single',
  'married',
  'divorced',
  'prefer_not_to_say',
]);
const SMOKING_HABIT = z.enum([
  'non_smoker',
  'occasional_smoker',
  'regular_smoker',
]);
const OCCUPATION = z.enum([
  'student',
  'nysc',
  'working_professional',
  'self_employed',
  'job_seeker',
]);

/**
 * Shared rule for the roommate's preferred areas. Used by both the create and
 * update flows. Areas are free-text but must be:
 *   - at most 3,
 *   - at least one non-empty (the first is effectively required),
 *   - distinct (case-insensitive).
 * Storage-side trimming/dedupe happens in the service, not here.
 */
export const preferredLocationsSchema = z
  .array(z.string().max(100, 'Each preferred location must be 100 characters or fewer'))
  .min(1, 'At least one preferred location is required')
  .max(3, 'You can add up to 3 preferred locations')
  .refine(
    (locs) => locs.some((l) => l.trim().length > 0),
    { message: 'At least one preferred location is required' },
  )
  .refine(
    (locs) => {
      const cleaned = locs.map((l) => l.trim().toLowerCase()).filter(Boolean);
      return new Set(cleaned).size === cleaned.length;
    },
    { message: 'Preferred locations must be different areas' },
  );

export const createProfileSchema = z.object({
  body: z.object({
    email: z.string().email('A valid email is required'),
    fullName: z.string().min(1, 'Full name is required').max(100),
    phoneNumber: z.string().regex(
      SUPPORTED_PHONE_REGEX,
      'Phone number must be a valid Nigerian or UK phone number (e.g. 08131234567, +2348131234567, 07123456789 or +447123456789)',
    ),
    gender: GENDER,
    ageRange: z.string().min(1, 'Age range is required').max(20),
    state: z.string().min(1, 'State is required').max(100),
    maritalStatus: MARITAL_STATUS.optional(),
    religion: z.string().max(50).optional(),

    preferredLocations: preferredLocationsSchema,

    budgetMin: z.number().min(0).default(0),
    budgetMax: z.number().min(0),
    expectedMoveInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: 'Expected move-in date must be a YYYY-MM-DD date',
    }),

    occupation: OCCUPATION,
    smokingHabit: SMOKING_HABIT.optional(),
    allowsPets: z.boolean().optional(),
    sleepHabit: z.string().max(50).optional(),
    personalBio: z.string().max(5000).optional(),

    agreedToTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must agree to the terms to register' }),
    }),
  }).refine(
    (data) => data.budgetMax >= data.budgetMin,
    {
      message: 'budgetMax must be greater than or equal to budgetMin',
      path: ['budgetMax'],
    },
  ),
  query: z.object({
    ref: z.string().max(30).optional(),
  }),
});

export const getAllUsersSchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  }),
});

/**
 * GET /profiles/search — admin search over roommate profiles.
 *
 * `state` is the only required filter; every other field is optional and
 * combined with AND. Budget filters use range-overlap semantics: a profile
 * matches when its own budget range intersects the requested [min,max] window.
 * `isActive` defaults to true (only active profiles) when omitted.
 */
export const searchProfilesSchema = z
  .object({
    query: z
      .object({
        state: z.string().min(1, 'State is required'),
        location: z.union([z.string(), z.array(z.string())]).optional(),
        minBudget: z.coerce.number().min(0).optional(),
        maxBudget: z.coerce.number().min(0).optional(),
        moveInDateFrom: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, {
            message: 'moveInDateFrom must be a YYYY-MM-DD date',
          })
          .optional(),
        moveInDateTo: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, {
            message: 'moveInDateTo must be a YYYY-MM-DD date',
          })
          .optional(),
        status: z.string().max(50).optional(),
        gender: GENDER.optional(),
        isActive: z.coerce.boolean().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .refine(
        (data) =>
          data.minBudget === undefined ||
          data.maxBudget === undefined ||
          data.maxBudget >= data.minBudget,
        {
          message: 'maxBudget must be greater than or equal to minBudget',
          path: ['maxBudget'],
        },
      ),
  });

/**
 * PATCH /profiles/by-phone — lets a user update their roommate request.
 *
 * Ownership is established by the Sido/WhatsApp conversation: the caller
 * supplies the profile's phone number (the trusted WhatsApp sender), which is
 * used to look up the profile. Only a limited subset of fields is editable;
 * system/identity/state fields stay locked so in-flight matches and the
 * same-state matching guarantee are preserved.
 */
export const updateProfileSchema = z
  .object({
    body: z
      .object({
        phoneNumber: z.string().regex(
          SUPPORTED_PHONE_REGEX,
          'Phone number must be a valid Nigerian or UK phone number',
        ),
        preferredLocations: preferredLocationsSchema.optional(),
        budgetMin: z.number().min(0).optional(),
        budgetMax: z.number().min(0).optional(),
        expectedMoveInDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, {
            message: 'Expected move-in date must be a YYYY-MM-DD date',
          })
          .optional(),
      })
      .refine(
        (data) =>
          ['preferredLocations', 'budgetMin', 'budgetMax', 'expectedMoveInDate'].some(
            (key) => data[key as keyof typeof data] !== undefined,
          ),
        { message: 'No fields provided to update' },
      ),
  });

/**
 * GET /profiles/lookup — admin lookup of a roommate profile by email or phone.
 *
 * Exactly one of `email` or `phoneNumber` must be supplied. Phone is matched
 * against all serialized forms of the same number; email is a case-insensitive
 * match (roommate_profiles.email is optional).
 */
export const getProfileByLookupSchema = z.object({
  query: z
    .object({
      email: z.string().email('A valid email is required').optional(),
      phoneNumber: z
        .string()
        .regex(
          SUPPORTED_PHONE_REGEX,
          'Phone number must be a valid Nigerian or UK phone number',
        )
        .optional(),
    })
    .refine(
      (data) => Boolean(data.email) || Boolean(data.phoneNumber),
      { message: 'Provide either an email or a phoneNumber to look up a profile' },
    ),
});

/**
 * PATCH /profiles/:id/status — admin sets a roommate request to paused or
 * suspended. A reason is required when suspending so it can be communicated to
 * the user in the WhatsApp notification; it is optional for pauses.
 */
export const updateProfileStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid('A valid profile id (uuid) is required'),
  }),
  body: z
    .object({
      status: z.enum(['paused', 'suspended']),
      reason: z.string().max(500, 'Reason must be 500 characters or fewer').optional(),
    })
    .superRefine((data, ctx) => {
      if (data.status === 'suspended' && !data.reason?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'A reason is required when suspending a profile',
          path: ['reason'],
        });
      }
    }),
});

export type CreateProfileInput = z.infer<
  typeof createProfileSchema
>['body'];

export type UpdateProfileInput = z.infer<
  typeof updateProfileSchema
>['body'];

export type GetProfileByLookupInput = z.infer<
  typeof getProfileByLookupSchema
>['query'];

export type SearchProfilesInput = z.infer<
  typeof searchProfilesSchema
>['query'];

export type UpdateProfileStatusInput = z.infer<
  typeof updateProfileStatusSchema
>;