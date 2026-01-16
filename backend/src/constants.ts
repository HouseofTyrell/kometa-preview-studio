/**
 * Application constants
 * Centralized configuration for magic numbers and shared values
 */

// Server configuration
export const DEFAULT_PORT = 3001;
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_CORS_ORIGIN = 'http://localhost:5173';

// File upload limits
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_JSON_SIZE = '10mb';

// Timeouts (in milliseconds)
export const PLEX_DEFAULT_TIMEOUT_MS = 30000; // 30 seconds
export const DOCKER_PULL_TIMEOUT_MS = 300000; // 5 minutes
export const SSE_HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds
export const SSE_CLOSE_DELAY_MS = 100; // Delay before closing SSE connection
export const JOB_POLL_INTERVAL_MS = 2000; // 2 seconds

// Job status values - single source of truth
export const JOB_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type JobStatusType = typeof JOB_STATUS[keyof typeof JOB_STATUS];

// Preview targets - single source of truth
export const PREVIEW_TARGET_IDS = {
  MATRIX: 'matrix',
  DUNE: 'dune',
  BREAKING_BAD_SERIES: 'breakingbad_series',
  BREAKING_BAD_S01: 'breakingbad_s01',
  BREAKING_BAD_S01E01: 'breakingbad_s01e01',
} as const;

// Media types
export const MEDIA_TYPES = {
  MOVIE: 'movie',
  SHOW: 'show',
  SEASON: 'season',
  EPISODE: 'episode',
} as const;

export type MediaType = typeof MEDIA_TYPES[keyof typeof MEDIA_TYPES];

// API paths
export const API_PATHS = {
  HEALTH: '/api/health',
  CONFIG: '/api/config',
  PREVIEW_START: '/api/preview/start',
  PREVIEW_STATUS: '/api/preview/status',
  PREVIEW_EVENTS: '/api/preview/events',
  PREVIEW_ARTIFACTS: '/api/preview/artifacts',
  PREVIEW_TARGETS: '/api/preview/targets',
} as const;

// Profile storage limits
export const MAX_PROFILES = 100;
export const PROFILE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// Rate limiting
export const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
export const RATE_LIMIT_MAX_REQUESTS = 200; // requests per window

// Pagination defaults
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  MIN_LIMIT: 1,
} as const;

// Retry configuration defaults
export const RETRY_DEFAULTS = {
  MAX_RETRIES: 3,
  INITIAL_DELAY_MS: 1000,
  MAX_DELAY_MS: 10000,
  BACKOFF_MULTIPLIER: 2,
  JITTER_MIN: 0.75,
  JITTER_RANDOM_MAX: 0.25,
} as const;

// TMDb API retry configuration
export const TMDB_RETRY = {
  API_MAX_RETRIES: 3,
  API_INITIAL_DELAY_MS: 1000,
  API_MAX_DELAY_MS: 8000,
  IMAGE_MAX_RETRIES: 3,
  IMAGE_INITIAL_DELAY_MS: 500,
  IMAGE_MAX_DELAY_MS: 4000,
} as const;

// Job progress milestones (percentage values)
export const PROGRESS = {
  JOB_STARTED: 5,
  PLEX_CONNECTED: 10,
  TARGETS_RESOLVED: 15,
  CONTAINER_CREATED: 20,
  ARTWORK_FETCHED: 30,
  CONFIG_GENERATED: 45,
  RENDERING_STARTED: 50,
  RENDERING_HALFWAY: 75,
  NEARLY_COMPLETE: 90,
  COMPLETED: 100,
} as const;

// Job queue configuration
export const QUEUE_CONFIG = {
  DEFAULT_ATTEMPTS: 1,
  BACKOFF_DELAY_MS: 5000,
  KEEP_COMPLETED_COUNT: 100,
  KEEP_COMPLETED_AGE_SECONDS: 24 * 60 * 60, // 24 hours
  KEEP_FAILED_COUNT: 50,
  KEEP_FAILED_AGE_SECONDS: 7 * 24 * 60 * 60, // 7 days
  WORKER_CONCURRENCY: 1,
  WORKER_LOCK_DURATION_MS: 600000, // 10 minutes
  WORKER_STALLED_INTERVAL_MS: 30000, // 30 seconds
} as const;

// Cache control (in seconds)
export const CACHE_CONTROL = {
  STATIC_IMAGE_AGE: 3600, // 1 hour
  DRAFT_IMAGE_AGE: 60, // 1 minute
} as const;

// Container management
export const CONTAINER_STOP_TIMEOUT_SECONDS = 5;
