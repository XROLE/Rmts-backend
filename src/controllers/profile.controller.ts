import { Request, Response } from 'express';
import { profileService } from '../services/profile.service.js';
import { whatsappLifecycleService } from '../services/whatsappLifecycle.service.js';
import type { WelcomeProfileInput } from '../services/whatsappLifecycle.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import type {
  UpdateProfileInput,
  GetProfileByLookupInput,
} from '../schemas/profile.schema.js';

/**
 * Handles the public registration + profile creation flow.
 */
export const createProfile = asyncHandler(
  async (req: Request, res: Response) => {
    const ref =
      typeof req.query.ref === 'string' && req.query.ref.trim()
        ? req.query.ref.trim()
        : undefined;
    const profile = await profileService.create(req.body, ref);

    // Send the welcome_to_roommate_ng confirmation template to the user's
    // WhatsApp contact. Fire-and-forget so a template/send failure never
    // breaks profile creation.
    void whatsappLifecycleService
      .sendWelcomeTemplate(profile as WelcomeProfileInput)
      .then((sent) => console.log(`[profile] welcome template ${sent ? 'sent' : 'skipped'}`))
      .catch((err) => console.error('[profile] welcome template failed:', err));

    res.status(201).json({
      success: true,
      message: 'Profile created successfully',
      data: profile,
    });
  },
);

/**
 * Handles updating a roommate request by the owner's phone number.
 *
 * Trust model: the phone number is supplied by the Sido/WhatsApp conversation
 * (the authenticated WhatsApp sender), not a public login. This endpoint should
 * only be reachable from that trusted context.
 */
export const updateProfileByPhone = asyncHandler(
  async (req: Request, res: Response) => {
    const { phoneNumber, ...updates } = req.body as UpdateProfileInput;
    const profile = await profileService.updateByPhone(
      phoneNumber,
      updates as Omit<UpdateProfileInput, 'phoneNumber'>,
    );

    res.status(200).json({
      success: true,
      message: 'Roommate request updated successfully',
      data: profile,
    });
  },
);

export const getProfileStats = asyncHandler(
  async (_req: AuthenticatedRequest, res: Response) => {
    const data = await profileService.getDashboardStats();
    res.status(200).json({
      success: true,
      message: 'Profile stats retrieved successfully',
      data,
    });
  },
);

export const getAllUsers = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);
    const { items, total } = await profileService.listAll(limit, offset);
    res.status(200).json({
      success: true,
      message: 'Users retrieved successfully',
      data: {
        items,
        pagination: { total, limit, offset },
      },
    });
  },
);

/**
 * Handles admin lookup of a roommate profile by email or phone number.
 */
export const getProfileByLookup = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { email, phoneNumber } = req.query as GetProfileByLookupInput;
    const profile = await profileService.getByLookup({ email, phoneNumber });
    res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully',
      data: profile,
    });
  },
);