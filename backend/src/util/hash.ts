import { createHash } from 'crypto';

/**
 * Generate a short hash from content
 */
export function shortHash(content: string, length: number = 8): string {
  return createHash('sha256').update(content).digest('hex').slice(0, length);
}

/**
 * Generate a unique job ID with timestamp
 */
export function generateJobId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `job_${timestamp}_${random}`;
}

/**
 * Generate a profile ID
 */
export function generateProfileId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `profile_${timestamp}_${random}`;
}
