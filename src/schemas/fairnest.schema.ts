import { z } from 'zod';
import { SUPPORTED_PHONE_REGEX } from '../utils/normalizePhone.js';

const GENDER = z.enum(['male', 'female', 'no_preference']);
const MARITAL_STATUS = z.enum([
  'single',
  'married',
  'divorced',
  'prefer_not_to_say',
]);
const OCCUPATION = z.enum([
  'student',
  'nysc',
  'working_professional',
  'self_employed',
  'job_seeker',
]);
const PROPERTY_TYPE = z.enum([
  'apartment',
  'house',
  'studio',
  'duplex',
  'bungalow',
  'self_contained',
]);

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

export const createFairnestSchema = z.object({
  body: z.object({
    fullName: z.string().min(1, 'Full name is required').max(100),
    gender: GENDER,
    occupation: OCCUPATION,
    email: z.string().email('A valid email is required'),
    phoneNumber: z.string().regex(
      SUPPORTED_PHONE_REGEX,
      'Phone number must be a valid Nigerian or UK phone number (e.g. 08131234567, +2348131234567, 07123456789 or +447123456789)',
    ),
    maritalStatus: MARITAL_STATUS.optional(),
    propertyType: PROPERTY_TYPE,
    preferredLocations: preferredLocationsSchema,
    budgetMin: z.number().min(0).default(0),
    budgetMax: z.number().min(0),
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

export const getAllFairnestSchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  }),
});

export type CreateFairnestInput = z.infer<
  typeof createFairnestSchema
>['body'];

export type GetAllFairnestInput = z.infer<
  typeof getAllFairnestSchema
>['query'];
