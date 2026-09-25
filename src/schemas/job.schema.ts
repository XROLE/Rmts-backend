import { z } from 'zod';
import { isSupportedPhone } from '../utils/normalizePhone.js';

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

const DEPARTMENT = z.enum(
  ['Engineering', 'Operations', 'Growth & Marketing', 'Product & Design'],
  {
    errorMap: () => ({
      message:
        "Department must be one of: Engineering, Operations, Growth & Marketing, Product & Design",
    }),
  },
);

const EMPLOYMENT_TYPE = z.enum(
  ['full-time', 'part-time', 'contract', 'internship'],
  {
    errorMap: () => ({
      message: "Employment type must be one of: full-time, part-time, contract, internship",
    }),
  },
);

const EXPERIENCE_LEVEL = z.enum(
  ['intern', 'junior', 'mid-level', 'senior', 'lead', 'manager'],
  {
    errorMap: () => ({
      message:
        "Experience level must be one of: intern, junior, mid-level, senior, lead, manager",
    }),
  },
);

const WORK_MODE = z.enum(['onsite', 'hybrid', 'remote'], {
  errorMap: () => ({
    message: "Work mode must be one of: onsite, hybrid, remote",
  }),
});

const CURRENCY = z.enum(['USD', 'NGN'], {
  errorMap: () => ({ message: "Currency must be 'USD' or 'NGN'" }),
});

const JOB_POSTING_FIELDS = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(150, 'Title must be 150 characters or fewer'),
  department: DEPARTMENT,
  employmentType: EMPLOYMENT_TYPE,
  experienceLevel: EXPERIENCE_LEVEL,
  workMode: WORK_MODE,
  location: z.string().trim().min(1, 'Location is required').max(100),
  salaryMin: z.coerce
    .number({ invalid_type_error: 'Salary minimum must be a number' })
    .min(0, 'Salary minimum cannot be negative')
    .optional(),
  salaryMax: z.coerce
    .number({ invalid_type_error: 'Salary maximum must be a number' })
    .min(0, 'Salary maximum cannot be negative')
    .optional(),
  currency: CURRENCY.default('NGN'),
  showSalary: z.boolean().default(true),
  description: z
    .string()
    .trim()
    .min(1, 'Description is required')
    .max(10000, 'Description must be 10,000 characters or fewer'),
  requirements: z
    .array(z.string().trim().min(1, 'Requirement cannot be empty').max(1000))
    .min(1, 'At least one requirement is required'),
  niceToHaves: z
    .array(z.string().trim().min(1, 'Nice-to-have cannot be empty').max(1000))
    .optional(),
  benefits: z
    .array(z.string().trim().min(1, 'Benefit cannot be empty').max(1000))
    .optional(),
  isActive: z.boolean().default(true),
  closingDate: z.union([z.coerce.date(), z.literal(null)]).optional(),
});

const salaryInRange = (data: { salaryMin?: number; salaryMax?: number }) =>
  data.salaryMax == null || data.salaryMin == null || data.salaryMax >= data.salaryMin;

const salaryRangeRefine = {
  message: 'salaryMax must be greater than or equal to salaryMin',
  path: ['salaryMax'] as ['salaryMax'],
} as const;

export const createJobPostingSchema = z.object({
  body: JOB_POSTING_FIELDS.refine(salaryInRange, salaryRangeRefine),
});

export const updateJobPostingSchema = z.object({
  params: z.object({
    id: z.string().uuid('A valid job posting ID is required'),
  }),
  body: JOB_POSTING_FIELDS.partial().refine(salaryInRange, salaryRangeRefine),
});

export const getJobPostingSchema = z.object({
  params: z.object({
    id: z.string().uuid('A valid job posting ID is required'),
  }),
});

export const getApplicationResumeSchema = z.object({
  params: z.object({
    applicationId: z.string().uuid('A valid application ID is required'),
  }),
});

const APPLICATION_STATUS = z.enum(
  ['new', 'to-be-interviewed', 'interviewed', 'rejected', 'archived', 'offered'],
  {
    errorMap: () => ({
      message:
        "Status must be one of: new, to-be-interviewed, interviewed, rejected, archived, offered",
    }),
  },
);

export const updateJobApplicationStatusSchema = z.object({
  params: z.object({
    applicationId: z.string().uuid('A valid application ID is required'),
  }),
  body: z.object({
    status: APPLICATION_STATUS,
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
      .refine((value) => isSupportedPhone(value), {
        message:
          'Phone number must be a valid Nigerian or UK phone number (e.g. 08131234567, +2348131234567, 07123456789 or +447123456789)',
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