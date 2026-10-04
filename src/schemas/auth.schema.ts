import { z } from 'zod';

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
  }),
});

export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>['body'];

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email('A valid email is required'),
  }),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>['body'];

export const resetPasswordSchema = z.object({
  body: z.object({
    email: z.string().email('A valid email is required'),
    code: z
      .string()
      .regex(/^\d{4}$/, 'Reset code must be a 4-digit number'),
    newPassword: z
      .string()
      .min(8, 'New password must be at least 8 characters')
      .max(72, 'New password must be at most 72 characters'),
  }),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>['body'];