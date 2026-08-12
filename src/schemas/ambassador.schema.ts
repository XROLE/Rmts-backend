import { z } from 'zod';

const NIGERIAN_PHONE_REGEX = /^(?:\+?234|0)[789][01]\d{8}$/;
const NIGERIAN_ACCOUNT_NUMBER_REGEX = /^\d{10}$/;

const NIGERIAN_STATES = [
  'abia', 'adamawa', 'akwa ibom', 'anambra', 'bauchi', 'bayelsa', 'benue',
  'borno', 'cross river', 'delta', 'ebonyi', 'edo', 'ekiti', 'enugu',
  'fct', 'gombe', 'imo', 'jigawa', 'kaduna', 'kano', 'katsina', 'kebbi',
  'kogi', 'kwara', 'lagos', 'nasarawa', 'niger', 'ogun', 'ondo', 'osun',
  'oyo', 'plateau', 'rivers', 'sokoto', 'taraba', 'yobe', 'zamfara',
] as const;

const SOCIAL_MEDIA_PLATFORMS = [
  'instagram', 'tiktok', 'twitter', 'facebook', 'whatsapp',
  'linkedin', 'snapchat', 'youtube', 'telegram',
] as const;

const EMERGENCY_CONTACT = z
  .object({
    name: z.string().min(1).max(100),
    phone: z.string().regex(NIGERIAN_PHONE_REGEX, 'Emergency contact phone must be a valid Nigerian phone number'),
    relationship: z.string().min(1).max(50),
  })
  .strict();

export const registerAmbassadorSchema = z.object({
  body: z.object({
    fullName: z.string().min(1, 'Full name is required').max(100),
    email: z.string().email('A valid email is required'),
    whatsappNumber: z.string().regex(
      NIGERIAN_PHONE_REGEX,
      'WhatsApp number must be a valid Nigerian phone number (e.g. 08131234567 or +2348131234567)',
    ),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(72, 'Password must be at most 72 characters'),
  }),
});

export const loginAmbassadorSchema = z.object({
  body: z.object({
    email: z.string().email('A valid email is required'),
    password: z.string().min(1, 'Password is required'),
  }),
});

export const updateAmbassadorProfileSchema = z.object({
  body: z
    .object({
      fullName: z.string().min(1, 'Full name is required').max(100).optional(),
      whatsappNumber: z
        .string()
        .regex(
          NIGERIAN_PHONE_REGEX,
          'WhatsApp number must be a valid Nigerian phone number',
        )
        .optional(),
      profilePictureUrl: z.string().url('Profile picture must be a valid URL').optional(),
      stateCovering: z
        .array(
          z
            .string()
            .trim()
            .toLowerCase()
            .refine(
              (s) => (NIGERIAN_STATES as readonly string[]).includes(s),
              'State must be a valid Nigerian state',
            ),
        )
        .max(1, 'stateCovering must be a single state')
        .optional(),
      emergencyContact: EMERGENCY_CONTACT.optional(),
      audienceCategory: z
        .array(z.string().min(1).max(50))
        .min(1, 'At least one audience category is required')
        .optional(),
      institutionOrOrganization: z.string().max(150).optional(),
      primaryOperating: z.string().max(150).optional(),
      secondaryOperating: z.string().max(150).optional(),
      socialMediaPlatform: z
        .array(z.enum(SOCIAL_MEDIA_PLATFORMS))
        .max(1, 'socialMediaPlatform must be a single platform')
        .optional(),
      socialMediaHandle: z.string().max(150).optional(),
      socialMediaTargetAudience: z.string().max(150).optional(),
      bankCode: z.string().min(1).max(20).optional(),
      bankName: z.string().min(1).max(100).optional(),
      accountNumber: z
        .string()
        .regex(
          NIGERIAN_ACCOUNT_NUMBER_REGEX,
          'Account number must be a 10-digit NUBAN number',
        )
        .optional(),
      accountName: z.string().min(1).max(100).optional(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one field must be provided to update',
    }),
});

export const changeAmbassadorPasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'New password must be at least 8 characters')
      .max(72, 'New password must be at most 72 characters'),
  }),
});

export const refreshAmbassadorTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
  }),
});

export type RegisterAmbassadorInput = z.infer<
  typeof registerAmbassadorSchema
>['body'];

export type LoginAmbassadorInput = z.infer<
  typeof loginAmbassadorSchema
>['body'];

export type UpdateAmbassadorProfileInput = z.infer<
  typeof updateAmbassadorProfileSchema
>['body'];

export type ChangeAmbassadorPasswordInput = z.infer<
  typeof changeAmbassadorPasswordSchema
>['body'];

export type RefreshAmbassadorTokenInput = z.infer<
  typeof refreshAmbassadorTokenSchema
>['body'];