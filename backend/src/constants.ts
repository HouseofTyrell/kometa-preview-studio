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
