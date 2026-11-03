import { Response } from 'express';
import { userService } from '../services/user.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

export const deleteUser = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const result = await userService.deactivateUser(id, req.user!.id);
    res.status(200).json({
      success: true,
      message: 'User deactivated successfully',
      data: result,
    });
  },
);
