/**
 * Resolves the public website base URL for the current environment.
 *
 * Sido's registration CTA, the /update-request deep link, and the
 * replacement-match form all need the correct website origin. That origin
 * depends on which environment the backend is running in (production,
 * staging, or development), so we derive it from NODE_ENV rather than
 * hardcoding one domain.
 *
 * Resolution order:
 *   1. Explicit SIDO_SITE_URL override (highest priority)
 *   2. Explicit SIDO_REGISTRATION_URL override
 *   3. NODE_ENV -> fairnesthousing domain map (production default)
 */

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function getEnvironment(): string {
  return (process.env.NODE_ENV ?? 'production').toLowerCase();
}

export function getSiteBaseUrl(): string {
  if (process.env.SIDO_SITE_URL) {
    return stripTrailingSlash(process.env.SIDO_SITE_URL);
  }
  if (process.env.SIDO_REGISTRATION_URL) {
    return stripTrailingSlash(process.env.SIDO_REGISTRATION_URL);
  }

  switch (getEnvironment()) {
    case 'staging':
      return 'https://staging.fairnesthousing.com';
    case 'development':
    case 'dev':
      return 'https://dev.fairnesthousing.com';
    case 'production':
    default:
      return 'https://www.fairnesthousing.com';
  }
}

export function getReplacementFormBaseUrl(): string {
  if (process.env.REPLACEMENT_FORM_BASE_URL) {
    return process.env.REPLACEMENT_FORM_BASE_URL;
  }
  return `${getSiteBaseUrl()}/request-replacement`;
}
