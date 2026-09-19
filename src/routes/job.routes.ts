import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { optionalAuth } from '../middleware/optionalAuth.js';
import { requireSuperAdmin } from '../middleware/requireSuperAdmin.js';
import { validate } from '../middleware/validate.js';
import {
  createJobApplicationSchema,
  createJobPostingSchema,
  getApplicationResumeSchema,
  getJobPostingSchema,
  listJobApplicationsSchema,
  updateJobPostingSchema,
} from '../schemas/job.schema.js';
import {
  createJobApplication,
  createJobPosting,
  downloadJobApplicationResume,
  getJobPosting,
  listJobApplications,
  listJobPostings,
  updateJobPosting,
} from '../controllers/job.controller.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Public: browse open job postings.
// Static /applications routes must be declared before the /:id param routes.
router.get('/', listJobPostings);

// Super admin: create a job posting.
router.post(
  '/',
  requireAuth,
  requireSuperAdmin,
  validate(createJobPostingSchema),
  createJobPosting,
);

// Public: submit a job application (multipart, resume uploaded to R2).
// Records the applicant when a valid token is supplied, otherwise anonymous.
router.post(
  '/applications',
  optionalAuth,
  upload.single('resume'),
  validate(createJobApplicationSchema),
  createJobApplication,
);

// Super admin: list all job applications.
router.get(
  '/applications',
  requireAuth,
  requireSuperAdmin,
  validate(listJobApplicationsSchema),
  listJobApplications,
);

// Super admin: stream a single application's resume from R2.
router.get(
  '/applications/:applicationId/resume',
  requireAuth,
  requireSuperAdmin,
  validate(getApplicationResumeSchema),
  downloadJobApplicationResume,
);

// Super admin: edit a job posting.
router.patch(
  '/:id',
  requireAuth,
  requireSuperAdmin,
  validate(updateJobPostingSchema),
  updateJobPosting,
);

// Public: fetch a single open job posting.
router.get('/:id', validate(getJobPostingSchema), getJobPosting);

export default router;