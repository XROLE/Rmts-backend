import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { supabase } from '../config/supabase.js';
import { HttpError } from '../middleware/errorHandler.js';
import { normalizePhoneToE164 } from '../utils/normalizePhone.js';
import { emailService } from './email.service.js';
import { r2Bucket, r2Client, r2PublicBaseUrl } from '../config/r2.js';
import type {
  CreateJobApplicationInput,
  CreateJobPostingInput,
  UpdateJobPostingInput,
} from '../schemas/job.schema.js';

const RESUME_ALLOWED_MIME_TYPES = new Set<string>([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const RESUME_MAX_BYTES = 5 * 1024 * 1024;

const APPLICATION_SELECT =
  'id, user_id, job_posting_id, full_name, email, phone_number, location, position, github_url, linkedin_url, resume_url, cover_note, notice_period, expected_salary_ngn, status, created_at';

export class JobService {
  /** Creates a job posting. Super-admin only (enforced at the route layer). */
  async createPosting(input: CreateJobPostingInput, createdBy: string) {
    const { data, error } = await supabase
      .from('job_postings')
      .insert({
        title: input.title,
        description: input.description,
        location: input.location,
        position: input.position,
        salary_range_ngn: input.salaryRangeNgn ?? null,
        status: input.status ?? 'open',
        created_by: createdBy,
      })
      .select('id, title, description, location, position, salary_range_ngn, status, created_at')
      .single();

    if (error || !data) {
      throw new HttpError(500, `Failed to create job posting: ${error?.message ?? 'unknown error'}`);
    }

    return data;
  }

  /** Updates a job posting. Super-admin only (enforced at the route layer). */
  async updatePosting(id: string, input: UpdateJobPostingInput['body']) {
    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      switch (key) {
        case 'title':
          update.title = value;
          break;
        case 'description':
          update.description = value;
          break;
        case 'location':
          update.location = value;
          break;
        case 'position':
          update.position = value;
          break;
        case 'salaryRangeNgn':
          update.salary_range_ngn = value || null;
          break;
        case 'status':
          update.status = value;
          break;
      }
    }

    const { data, error } = await supabase
      .from('job_postings')
      .update(update)
      .eq('id', id)
      .select('id, title, description, location, position, salary_range_ngn, status, updated_at')
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Failed to update job posting: ${error.message}`);
    }

    if (!data) {
      throw new HttpError(404, 'Job posting not found');
    }

    return data;
  }

  /** Lists open job postings, newest first. Public. */
  async listPostings() {
    const { data, error } = await supabase
      .from('job_postings')
      .select(
        'id, title, description, location, position, salary_range_ngn, status, created_at',
      )
      .eq('status', 'open')
      .order('created_at', { ascending: false });

    if (error) {
      throw new HttpError(500, `Failed to list job postings: ${error.message}`);
    }

    return data ?? [];
  }

  /** Returns a single open job posting. Public. */
  async getPosting(id: string) {
    const { data, error } = await supabase
      .from('job_postings')
      .select(
        'id, title, description, location, position, salary_range_ngn, status, created_at',
      )
      .eq('id', id)
      .eq('status', 'open')
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Failed to fetch job posting: ${error.message}`);
    }

    if (!data) {
      throw new HttpError(404, 'Job posting not found');
    }

    return data;
  }

  /**
   * Submits a job application: uploads the resume to Cloudflare R2, persists
   * the application row, then best-effort notifies the careers inbox. The
   * email never blocks or fails the request.
   */
  async createApplication(
    userId: string,
    input: CreateJobApplicationInput,
    file: { buffer: Buffer; mimetype: string; size: number; originalname: string },
  ) {
    const resumeUrl = await this.uploadResume(file);
    const githubUrl = input.githubUrl?.trim() || null;

    const { data: application, error: insertError } = await supabase
      .from('job_applications')
      .insert({
        user_id: userId,
        job_posting_id: input.jobPostingId ?? null,
        full_name: input.fullName,
        email: input.email,
        phone_number: normalizePhoneToE164(input.phoneNumber),
        location: input.location,
        position: input.position,
        github_url: githubUrl,
        linkedin_url: input.linkedinUrl.trim() || null,
        resume_url: resumeUrl,
        cover_note: input.coverNote,
        notice_period: input.noticePeriod,
        expected_salary_ngn: input.expectedSalary,
      })
      .select(APPLICATION_SELECT)
      .single();

    if (insertError || !application) {
      throw new HttpError(
        500,
        `Failed to store job application: ${insertError?.message ?? 'unknown error'}`,
      );
    }

    this.notifyCareers(application).catch((err) => {
      console.error('Failed to email job application:', err);
    });

    return application;
  }

  /** Lists all job applications, newest first. Super-admin only. */
  async listApplications(limit = 20, offset = 0) {
    const { data, count, error } = await supabase
      .from('job_applications')
      .select(APPLICATION_SELECT, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new HttpError(500, `Failed to list job applications: ${error.message}`);
    }

    return { applications: data ?? [], total: count ?? 0 };
  }

  /**
   * Uploads a resume to Cloudflare R2 and returns its public URL. Rejects
   * non-document files and anything over RESUME_MAX_BYTES.
   */
  private async uploadResume(file: {
    buffer: Buffer;
    mimetype: string;
    size: number;
    originalname: string;
  }): Promise<string> {
    const mimeType = file.mimetype?.toLowerCase() ?? '';
    if (!RESUME_ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new HttpError(400, 'Resume must be a PDF or Word (.doc/.docx) document');
    }

    if (file.size > RESUME_MAX_BYTES) {
      throw new HttpError(400, 'Resume must be at most 5MB');
    }

    const ext = extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
    const key = `resumes/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${ext}`;

    try {
      await r2Client.send(
        new PutObjectCommand({
          Bucket: r2Bucket,
          Key: key,
          Body: file.buffer,
          ContentType: mimeType,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      throw new HttpError(500, `Failed to upload resume: ${message}`);
    }

    if (!r2PublicBaseUrl) {
      throw new HttpError(500, 'R2 public base URL is not configured');
    }

    return `${r2PublicBaseUrl.replace(/\/$/, '')}/${key}`;
  }

  private async notifyCareers(application: {
    full_name: string;
    email: string;
    phone_number: string;
    location: string;
    position: string;
    github_url: string | null;
    linkedin_url: string | null;
    resume_url: string;
    cover_note: string;
    notice_period: string;
    expected_salary_ngn: number;
  }): Promise<void> {
    await emailService.sendJobApplication({
      fullName: application.full_name,
      email: application.email,
      phone: application.phone_number,
      position: application.position,
      location: application.location,
      noticePeriod: application.notice_period,
      expectedSalary: String(application.expected_salary_ngn),
      coverNote: application.cover_note,
      resumeUrl: application.resume_url,
      linkedinUrl: application.linkedin_url ?? undefined,
      githubUrl: application.github_url ?? undefined,
    });
  }
}

export const jobService = new JobService();