import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/requireSuperAdmin.js';
import { validate } from '../middleware/validate.js';
import {
  createJobApplicationSchema,
  createJobPostingSchema,
  getJobPostingSchema,
  listJobApplicationsSchema,
  updateJobPostingSchema,
} from '../schemas/job.schema.js';
import {
  createJobApplication,
  createJobPosting,
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

// Authenticated: submit a job application (multipart, resume uploaded to R2).
router.post(
  '/applications',
  requireAuth,
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