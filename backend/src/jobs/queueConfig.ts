/**
 * BullMQ Queue Configuration
 *
 * Centralized Redis connection and queue configuration for job processing.
 * Supports both development (in-memory) and production (Redis) modes.
 */

import { ConnectionOptions } from 'bullmq';
import { jobLogger } from '../util/logger.js';

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
  attempts: 1, // Preview jobs shouldn't auto-retry (user can manually retry)
  backoff: {
    type: 'exponential' as const,
    delay: 5000,
  },
  removeOnComplete: {
    count: 100, // Keep last 100 completed jobs
    age: 24 * 60 * 60, // Keep for 24 hours
  },
  removeOnFail: {
    count: 50, // Keep last 50 failed jobs
    age: 7 * 24 * 60 * 60, // Keep for 7 days
  },
};

/**
 * Worker concurrency settings
 */
export const WORKER_CONFIG = {
  concurrency: 1, // Process one job at a time (resource intensive)
  lockDuration: 600000, // 10 minutes lock (Kometa jobs can be long)
  stalledInterval: 30000, // Check for stalled jobs every 30 seconds
};
