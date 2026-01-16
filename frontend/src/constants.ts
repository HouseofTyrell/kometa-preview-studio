/**
 * Frontend application constants
 * Centralized configuration for magic numbers and shared values
 */

// Debounce and timing (in milliseconds)
export const DEBOUNCE_MS = {
  AUTOSAVE: 1000, // Auto-save debounce delay
  SEARCH: 300, // Search input debounce
} as const;

// Message timeout durations (in milliseconds)
export const MESSAGE_TIMEOUT_MS = {
  ERROR: 5000,
  SUCCESS: 3000,
  INFO: 4000,
} as const;

// Polling intervals (in milliseconds)
export const POLLING_INTERVAL_MS = {
  JOB_STATUS: 2000,
  EXPIRY_UPDATE: 60000, // 1 minute
} as const;

// Action delays (in milliseconds)
export const ACTION_DELAY_MS = 500;

// Zoom controls
export const ZOOM = {
  MIN: 0.5,
  MAX: 4,
  STEP: 0.25,
  DEFAULT: 1,
} as const;

// Undo/redo history
export const UNDO_HISTORY = {
  MAX_SIZE: 50,
} as const;

// Time durations
export const TIME = {
  PROFILE_EXPIRY_WARNING_HOURS: 2, // Show warning when profile expires in less than 2 hours
  HOURS_IN_DAY: 24,
  DRAFT_MAX_AGE_HOURS: 24,
  MILLISECONDS_PER_MINUTE: 1000 * 60,
  MINUTES_PER_HOUR: 60,
} as const;

// Pagination
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
} as const;
