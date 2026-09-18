import 'dotenv/config';
import { S3Client } from '@aws-sdk/client-s3';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

if (!accountId || !accessKeyId || !secretAccessKey) {
  throw new Error(
    'Missing Cloudflare R2 configuration. Set CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in your environment.',
  );
}

export const r2Bucket = process.env.R2_BUCKET_NAME ?? 'rmts';

export const r2PublicBaseUrl = process.env.R2_PUBLIC_BASE_URL;

/**
 * Cloudflare R2 is S3-compatible, so it is accessed through the AWS S3
 * client pointed at the account's R2 endpoint with `region: 'auto'`.
 */
export const r2Client: S3Client = new S3Client({
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  region: 'auto',
  credentials: { accessKeyId, secretAccessKey },
});