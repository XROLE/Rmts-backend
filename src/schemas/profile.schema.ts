import { z } from 'zod';

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

const NIGERIAN_PHONE_REGEX = /^(?:\+?234|0)[789][01]\d{8}$/;

export const createProfileSchema = z.object({
  body: z.object({
    email: z.string().email('A valid email is required'),
    fullName: z.string().min(1, 'Full name is required').max(100),
    phoneNumber: z.string().regex(
      NIGERIAN_PHONE_REGEX,
      'Phone number must be a valid Nigerian phone number (e.g. 08131234567 or +2348131234567)',
    ),
    gender: GENDER,
    ageRange: z.string().min(1, 'Age range is required').max(20),
    maritalStatus: MARITAL_STATUS.optional(),
    religion: z.string().max(50).optional(),

    preferredLocations: z
      .array(z.string().min(1).max(100))
      .min(1, 'At least one preferred location is required'),

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

export type CreateProfileInput = z.infer<
  typeof createProfileSchema
>['body'];