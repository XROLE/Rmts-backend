import { z } from 'zod';
import { SUPPORTED_PHONE_REGEX } from '../utils/normalizePhone.js';

const NIGERIAN_ACCOUNT_NUMBER_REGEX = /^\d{10}$/;

const NIGERIAN_STATES = [
  'abia', 'adamawa', 'akwa ibom', 'anambra', 'bauchi', 'bayelsa', 'benue',
  'borno', 'cross river', 'delta', 'ebonyi', 'edo', 'ekiti', 'enugu',
  'fct', 'gombe', 'imo', 'jigawa', 'kaduna', 'kano', 'katsina', 'kebbi',
  'kogi', 'kwara', 'lagos', 'nasarawa', 'niger', 'ogun', 'ondo', 'osun',
  'oyo', 'plateau', 'rivers', 'sokoto', 'taraba', 'yobe', 'zamfara',
] as const;

const SOCIAL_MEDIA_PLATFORMS = [
  'instagram', 'tiktok', 'twitter', 'facebook',
  'linkedin', 'snapchat', 'youtube',
] as const;

type SocialMediaPlatform = (typeof SOCIAL_MEDIA_PLATFORMS)[number];

const SOCIAL_MEDIA_PLATFORM_LABELS: Record<SocialMediaPlatform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  twitter: 'X (Twitter)',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  snapchat: 'Snapchat',
  youtube: 'YouTube',
};

const SOCIAL_MEDIA_PLATFORM_DOMAINS: Record<SocialMediaPlatform, string[]> = {
  instagram: ['instagram.com'],
  tiktok: ['tiktok.com'],
  twitter: ['x.com', 'twitter.com'],
  facebook: ['facebook.com'],
  linkedin: ['linkedin.com'],
  snapchat: ['snapchat.com'],
  youtube: ['youtube.com'],
};

const SOCIAL_MEDIA_PLATFORM_EXAMPLES: Record<SocialMediaPlatform, string> = {
  instagram: 'https://instagram.com/username',
  tiktok: 'https://www.tiktok.com/@username',
  twitter: 'https://x.com/username',
  facebook: 'https://facebook.com/username',
  linkedin: 'https://linkedin.com/in/username',
  snapchat: 'https://www.snapchat.com/add/username',
  youtube: 'https://youtube.com/@username',
};

const RESERVED_PROFILE_SEGMENTS: Record<string, string[]> = {
  instagram: [
    'about', 'accounts', 'explore', 'login', 'p', 'privacy', 'reel', 'reels',
    'terms', 'tv', 'directory', 'stories', 'embed', 'create', 'why_this',
  ],
  twitter: [
    'home', 'i', 'explore', 'settings', 'messages', 'notifications', 'search',
    'share', 'intent', 'compose', 'login', 'signup', 'about', 'privacy', 'tos',
    'oauth',
  ],
  facebook: [
    'login', 'help', 'settings', 'privacy', 'terms', 'policies', 'games',
    'groups', 'pages', 'watch', 'marketplace', 'events', 'photos', 'video',
    'story.php', 'home.php', 'friends', 'me', 'search', 'ads', 'business',
    'developers', 'about',
  ],
};

function hasValidProfilePath(platform: SocialMediaPlatform, url: URL): boolean {
  const segments = url.pathname.split('/').filter(Boolean).map((s) => s.toLowerCase());
  if (segments.length === 0) return false;
  const first = segments[0];

  switch (platform) {
    case 'instagram':
      return (
        /^[a-z0-9._]{1,30}$/.test(first) &&
        !RESERVED_PROFILE_SEGMENTS.instagram.includes(first)
      );
    case 'tiktok':
      return /^@[a-z0-9._]{1,24}$/.test(first);
    case 'twitter':
      return (
        /^[a-z0-9_]{1,15}$/.test(first) &&
        !RESERVED_PROFILE_SEGMENTS.twitter.includes(first)
      );
    case 'facebook':
      if (first === 'profile.php') {
        return segments.length === 1 && /^\d+$/.test(url.searchParams.get('id') ?? '');
      }
      if (first === 'people') {
        return segments.length >= 3 && /^\d+$/.test(segments[2]);
      }
      return (
        /^[a-z0-9.]{1,50}$/.test(first) &&
        !RESERVED_PROFILE_SEGMENTS.facebook.includes(first)
      );
    case 'snapchat':
      return (
        (first === 'add' || first === 'u') &&
        segments.length >= 2 &&
        /^[a-z0-9._-]{3,30}$/.test(segments[1])
      );
    case 'linkedin':
      return (
        (first === 'in' || first === 'company') &&
        segments.length >= 2 &&
        /^[a-z0-9-]{1,100}$/.test(segments[1])
      );
    case 'youtube':
      if (first.startsWith('@')) return /^@[a-z0-9._-]{1,30}$/.test(first);
      return (
        ['c', 'user', 'channel'].includes(first) &&
        segments.length >= 2 &&
        /^[a-z0-9_-]{1,100}$/.test(segments[1])
      );
  }
}

const EMERGENCY_CONTACT = z
  .object({
    name: z.string().min(1).max(100),
    phone: z.string().regex(SUPPORTED_PHONE_REGEX, 'Emergency contact phone must be a valid Nigerian or UK phone number'),
    relationship: z.string().min(1).max(50),
  })
  .strict();

export const registerAmbassadorSchema = z.object({
  body: z.object({
    fullName: z.string().min(1, 'Full name is required').max(100),
    email: z.string().email('A valid email is required'),
    whatsappNumber: z.string().regex(
      SUPPORTED_PHONE_REGEX,
      'WhatsApp number must be a valid Nigerian or UK phone number (e.g. 08131234567, +2348131234567, 07123456789 or +447123456789)',
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
      email: z.string().email('A valid email is required').optional(),
      whatsappNumber: z
        .string()
        .regex(
          SUPPORTED_PHONE_REGEX,
          'WhatsApp number must be a valid Nigerian or UK phone number',
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
      socialMediaHandle: z
        .string()
        .max(2048, 'Social media link must be 2048 characters or fewer')
        .optional(),
      socialMediaTargetAudience: z.string().max(150).optional(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one field must be provided to update',
    })
    .superRefine((data, ctx) => {
      const link = data.socialMediaHandle;
      if (link === undefined) return;

      const platform = data.socialMediaPlatform?.[0];
      const label = platform ? SOCIAL_MEDIA_PLATFORM_LABELS[platform] : 'social media';
      const addIssue = () =>
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['socialMediaHandle'],
          message: platform
            ? `Social media handle must be a valid ${label} profile link, e.g. ${SOCIAL_MEDIA_PLATFORM_EXAMPLES[platform]}`
            : 'Social media handle must be a valid social media profile link',
        });

      let url: URL;
      try {
        url = new URL(link);
      } catch {
        addIssue();
        return;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        addIssue();
        return;
      }
      if (!platform) return;

      const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
      const allowed = SOCIAL_MEDIA_PLATFORM_DOMAINS[platform];
      if (
        !allowed.some((domain) => host === domain || host.endsWith(`.${domain}`)) ||
        !hasValidProfilePath(platform, url)
      ) {
        addIssue();
      }
    }),
});

export const verifyBankDetailsSchema = z.object({
  body: z.object({
    accountNumber: z
      .string()
      .regex(
        NIGERIAN_ACCOUNT_NUMBER_REGEX,
        'Account number must be a 10-digit NUBAN number',
      ),
    bankCode: z.string().min(1).max(20),
    bankName: z.string().min(1).max(100).optional(),
  }),
});

export const saveBankDetailsSchema = z.object({
  body: z.object({
    accountNumber: z
      .string()
      .regex(
        NIGERIAN_ACCOUNT_NUMBER_REGEX,
        'Account number must be a 10-digit NUBAN number',
      ),
    bankCode: z.string().min(1).max(20),
    bankName: z.string().min(1).max(100),
    accountName: z.string().min(1).max(100),
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

export const getAllAmbassadorsSchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  }),
});

export const getAmbassadorPayoutsSchema = z.object({
  query: z.object({
    status: z.enum(['pending', 'paid', 'failed', 'rejected']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  }),
});

export const deleteAmbassadorSchema = z.object({
  params: z.object({
    id: z.string().uuid('A valid ambassador profile ID is required'),
  }),
});

export const confirmAmbassadorApprovalSchema = z.object({
  params: z.object({
    id: z.string().uuid('A valid ambassador profile ID is required'),
  }),
  body: z
    .object({
      action: z.enum(['approve', 'reject'], {
        errorMap: () => ({ message: "Action must be 'approve' or 'reject'" }),
      }),
      reason: z.string().min(1).max(500).optional(),
    })
    .superRefine((data, ctx) => {
      if (data.action === 'reject' && !data.reason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reason'],
          message: 'A rejection reason is required',
        });
      }
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

export type VerifyBankDetailsInput = z.infer<
  typeof verifyBankDetailsSchema
>['body'];

export type SaveBankDetailsInput = z.infer<
  typeof saveBankDetailsSchema
>['body'];

export type RefreshAmbassadorTokenInput = z.infer<
  typeof refreshAmbassadorTokenSchema
>['body'];

export type GetAmbassadorPayoutsInput = z.infer<
  typeof getAmbassadorPayoutsSchema
>['query'];

export type ConfirmAmbassadorApprovalInput = z.infer<
  typeof confirmAmbassadorApprovalSchema
>['body'];

export type DeleteAmbassadorInput = z.infer<
  typeof deleteAmbassadorSchema
>['params'];