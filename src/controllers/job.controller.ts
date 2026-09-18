import type { Response } from 'express';
import { jobService } from '../services/job.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

export const createJobPosting = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const posting = await jobService.createPosting(req.body, req.user!.id);
    res.status(201).json({
      success: true,
      message: 'Job posting created successfully',
      data: posting,
    });
  },
);

export const updateJobPosting = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const posting = await jobService.updatePosting(req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Job posting updated successfully',
      data: posting,
    });
  },
);

export const listJobPostings = asyncHandler(async (_req, res: Response) => {
  const postings = await jobService.listPostings();
  res.status(200).json({
    success: true,
    message: 'Job postings fetched successfully',
    data: postings,
  });
});

export const getJobPosting = asyncHandler(async (req, res: Response) => {
  const posting = await jobService.getPosting(req.params.id);
  res.status(200).json({
    success: true,
    message: 'Job posting fetched successfully',
    data: posting,
  });
});

export const createJobApplication = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const file = (req as AuthenticatedRequest & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({
        success: false,
        message: 'A resume file (PDF or Word) is required',
      });
      return;
    }

    const application = await jobService.createApplication(req.user!.id, req.body, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      size: file.size,
      originalname: file.originalname,
    });

    res.status(201).json({
      success: true,
      message: 'Job application submitted successfully',
      data: application,
    });
  },
);

export const listJobApplications = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);
    const result = await jobService.listApplications(limit, offset);
    res.status(200).json({
      success: true,
      message: 'Job applications fetched successfully',
      data: result,
    });
  },
);