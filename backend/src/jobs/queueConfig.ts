/**
 * BullMQ Queue Configuration
 *
 * Centralized Redis connection and queue configuration for job processing.
 * Supports both development (in-memory) and production (Redis) modes.
 */

import { ConnectionOptions } from 'bullmq';
import { jobLogger } from '../util/logger.js';
import { QUEUE_CONFIG } from '../constants.js';

/**
 * Redis connection configuration
 * Reads from environment variables with sensible defaults
 */
export function getRedisConfig(): ConnectionOptions {
  const host = process.env.REDIS_HOST || 'localhost';
  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  const password = process.env.REDIS_PASSWORD || undefined;
  const db = parseInt(process.env.REDIS_DB || '0', 10);

  jobLogger.info({ host, port, db }, 'Redis connection config');

  return {
    host,
    port,
    password,
    db,
    maxRetriesPerRequest: null, // Required for BullMQ
  };
}

/**
 * Queue names used in the application
 */
export const QUEUE_NAMES = {
  PREVIEW_JOBS: 'preview-jobs',
} as const;

/**
 * Default job options
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: QUEUE_CONFIG.DEFAULT_ATTEMPTS, // Preview jobs shouldn't auto-retry (user can manually retry)
  backoff: {
    type: 'exponential' as const,
    delay: QUEUE_CONFIG.BACKOFF_DELAY_MS,
  },
  removeOnComplete: {
    count: QUEUE_CONFIG.KEEP_COMPLETED_COUNT,
    age: QUEUE_CONFIG.KEEP_COMPLETED_AGE_SECONDS,
  },
  removeOnFail: {
    count: QUEUE_CONFIG.KEEP_FAILED_COUNT,
    age: QUEUE_CONFIG.KEEP_FAILED_AGE_SECONDS,
  },
};

/**
 * Worker concurrency settings
 */
export const WORKER_CONFIG = {
  concurrency: QUEUE_CONFIG.WORKER_CONCURRENCY, // Process one job at a time (resource intensive)
  lockDuration: QUEUE_CONFIG.WORKER_LOCK_DURATION_MS, // 10 minutes lock (Kometa jobs can be long)
  stalledInterval: QUEUE_CONFIG.WORKER_STALLED_INTERVAL_MS, // Check for stalled jobs every 30 seconds
};
