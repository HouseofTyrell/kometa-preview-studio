/**
 * Shared Types for Kometa Preview Studio
 *
 * This module defines types that are shared between the frontend and backend.
 * Import from this file to ensure type consistency across the codebase.
 *
 * Usage:
 *   Backend: import { JobStatus, MediaType } from '../shared/types.js';
 *   Frontend: import { JobStatus, MediaType } from '../../shared/types';
 */

// ============================================================
// Job Status Types
// ============================================================

/** Job status values - matches backend JOB_STATUS constants */
export type JobStatusValue =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const JobStatusValues = {
  PENDING: 'pending' as const,
  RUNNING: 'running' as const,
  PAUSED: 'paused' as const,
  COMPLETED: 'completed' as const,
  FAILED: 'failed' as const,
  CANCELLED: 'cancelled' as const,
};

/** Full job status response from API */
export interface JobStatus {
  jobId: string;
  status: JobStatusValue;
  progress: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  exitCode?: number;
  error?: string;
  warnings: string[];
  targets: JobTarget[];
}

/** Individual job target within a job */
export interface JobTarget {
  id: string;
  title: string;
  type: MediaType;
  baseSource: string;
  hasWarnings: boolean;
}

// ============================================================
// Media Types
// ============================================================

/** Media types for preview targets */
export type MediaType = 'movie' | 'show' | 'season' | 'episode';

export const MediaTypes = {
  MOVIE: 'movie' as const,
  SHOW: 'show' as const,
  SEASON: 'season' as const,
  EPISODE: 'episode' as const,
};

// ============================================================
// Preview Target Types
// ============================================================

/** Preview target definition */
export interface PreviewTarget {
  id: string;
  label: string;
  type: MediaType;
  displayType: string;
  metadata: PreviewTargetMetadata;
}

/** Metadata for preview targets */
export interface PreviewTargetMetadata {
  title: string;
  year?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  tmdbId?: number;
}

/** Preview target IDs - matches backend PREVIEW_TARGET_IDS */
export const PreviewTargetIds = {
  MATRIX: 'matrix',
  DUNE: 'dune',
  BREAKING_BAD_SERIES: 'breakingbad_series',
  BREAKING_BAD_S01: 'breakingbad_s01',
  BREAKING_BAD_S01E01: 'breakingbad_s01e01',
} as const;

// ============================================================
// Config Types
// ============================================================

/** Analysis result from uploading/parsing a config */
export interface ConfigAnalysis {
  profileId: string;
  plexUrl: string | null;
  tokenPresent: boolean;
  assetDirectories: string[];
  overlayFiles: string[];
  libraryNames: string[];
  warnings: string[];
  overlayYaml: string;
  expiresAt?: string;  // ISO timestamp when this profile will auto-expire
}

// ============================================================
// Artifact Types
// ============================================================

/** Single artifact item from a completed job */
export interface JobArtifactItem {
  id: string;
  title: string;
  type: string;
  beforeUrl: string;
  afterUrl: string;
  draftUrl?: string;  // Instant preview shown while Kometa renders
  baseSource: string;
  warnings: string[];
}

/** Collection of artifacts from a job */
export interface JobArtifacts {
  jobId: string;
  items: JobArtifactItem[];
}

// ============================================================
// Event Types
// ============================================================

/** SSE event from job progress stream */
export interface JobEvent {
  type: 'progress' | 'log' | 'warning' | 'error' | 'complete';
  timestamp: string;
  message: string;
  progress?: number;
  data?: Record<string, unknown>;
}

// ============================================================
// System Control Types
// ============================================================

/** System action type */
export type SystemAction = 'start' | 'stop' | 'reset';

/** Result of a system action */
export interface SystemActionResult {
  action: SystemAction;
  status: 'success' | 'failed';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
}

// ============================================================
// Test Options Types
// ============================================================

/** Options for starting a preview job */
export interface TestOptions {
  targetId: string;
  profileId: string;
  selectedOverlays?: string[];
  useInstantPreview?: boolean;
}

// ============================================================
// API Response Types
// ============================================================

/** Standard API error response */
export interface ApiError {
  error: string;
  details?: string;
  code?: string;
}

/** Paginated response wrapper */
export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}
