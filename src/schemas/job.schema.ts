import { z } from 'zod';
import { normalizePhoneToE164 } from '../utils/normalizePhone.js';

/**
 * Accepts a blank string (absent optional input), a trimmed valid URL, or
 * undefined. Empty strings are normalized away in the service layer.
 */
function optionalUrl(label: string) {
  return z.union([
    z.literal(''),
    z.string().trim().url(`${label} must be a valid URL`),
  ]);
}

export const createJobPostingSchema = z.object({
  body: z.object({
    title: z
      .string()
      .trim()
      .min(1, 'Title is required')
      .max(150, 'Title must be 150 characters or fewer'),
    description: z
      .string()
      .trim()
      .min(1, 'Description is required')
      .max(10000, 'Description must be 10,000 characters or fewer'),
    location: z.string().trim().min(1, 'Location is required').max(100),
    position: z.string().trim().min(1, 'Position is required').max(100),
    salaryRangeNgn: z
      .string()
      .trim()
      .max(100, 'Salary range must be 100 characters or fewer')
      .optional(),
    status: z
      .enum(['open', 'closed'], {
        errorMap: () => ({ message: "Status must be 'open' or 'closed'" }),
      })
      .optional(),
  }),
});

export const updateJobPostingSchema = z.object({
  params: z.object({
    id: z.string().uuid('A valid job posting ID is required'),
  }),
  body: createJobPostingSchema.shape.body.partial(),
});

export const getJobPostingSchema = z.object({
  params: z.object({
    id: z.string().uuid('A valid job posting ID is required'),
  }),
});

export const createJobApplicationSchema = z.object({
  body: z.object({
    jobPostingId: z.string().uuid('A valid job posting ID is required').optional(),
    fullName: z.string().trim().min(1, 'Full name is required').max(100),
    email: z.string().trim().email('A valid email is required'),
    phoneNumber: z
      .string()
      .trim()
      .refine((value) => normalizePhoneToE164(value) !== null, {
        message:
          'Phone number must be a valid Nigerian phone number (e.g. 08131234567 or +2348131234567)',
      }),
    location: z.string().trim().min(1, 'Location is required').max(100),
    position: z.string().trim().min(1, 'Position is required').max(100),
    githubUrl: optionalUrl('GitHub URL').optional(),
    linkedinUrl: optionalUrl('LinkedIn URL'),
    coverNote: z
      .string()
      .trim()
      .min(1, 'Cover note is required')
      .max(5000, 'Cover note must be 5,000 characters or fewer'),
    noticePeriod: z.string().trim().min(1, 'Notice period is required').max(100),
    expectedSalary: z.coerce
      .number({ invalid_type_error: 'Expected salary must be a number' })
      .min(0, 'Expected salary cannot be negative'),
  }),
});

export const listJobApplicationsSchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  }),
});

export type CreateJobPostingInput = z.infer<typeof createJobPostingSchema>['body'];
export type UpdateJobPostingInput = z.infer<typeof updateJobPostingSchema>;
export type CreateJobApplicationInput = z.infer<
  typeof createJobApplicationSchema
>['body'];