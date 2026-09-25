import type { Response } from 'express';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { jobService } from '../services/job.service.js';
import { r2Bucket, r2Client } from '../config/r2.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

function resumeKeyFromUrl(resumeUrl: string | null): string | null {
  if (!resumeUrl) return null;
  try {
    const key = new URL(resumeUrl).pathname.replace(/^\/+/, '');
    return key || null;
  } catch {
    return null;
  }
}

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

    const application = await jobService.createApplication(req.user?.id ?? null, req.body, {
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

export const updateJobApplicationStatus = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const application = await jobService.updateApplicationStatus(
      req.params.applicationId,
      req.body.status,
    );
    res.status(200).json({
      success: true,
      message: 'Job application status updated successfully',
      data: application,
    });
  },
);

export const downloadJobApplicationResume = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const application = await jobService.getApplication(req.params.applicationId);
    const key = resumeKeyFromUrl(application.resume_url);
    if (!key) {
      res.status(404).json({
        success: false,
        message: 'No resume is attached to this application',
      });
      return;
    }

    let object;
    try {
      object = await r2Client.send(new GetObjectCommand({ Bucket: r2Bucket, Key: key }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      res.status(500).json({
        success: false,
        message: `Failed to fetch resume: ${message}`,
      });
      return;
    }

    const body = object.Body as NodeJS.ReadableStream | undefined;
    if (!body) {
      res.status(404).json({
        success: false,
        message: 'Resume file could not be retrieved',
      });
      return;
    }

    const ext = key.slice(key.lastIndexOf('.')).toLowerCase() || '.pdf';
    const safeName = (application.full_name || 'application')
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .toLowerCase();

    res.setHeader('Content-Type', object.ContentType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="resume-${safeName}${ext}"`);

    body.on('error', (err) => {
      console.error('Failed to stream resume:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Failed to stream resume' });
      }
      res.end();
    });

    body.pipe(res);
  },
);