import { TestOptions } from '../types/testOptions'

const API_BASE = '/api';

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

// Job status values - must match backend/src/constants.ts
export type JobStatusValue = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

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
  targets: Array<{
    id: string;
    title: string;
    baseSource: string;
    hasWarnings: boolean;
  }>;
}

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

export interface JobArtifacts {
  jobId: string;
  items: JobArtifactItem[];
}

export interface JobEvent {
  type: string;
  timestamp: string;
  message: string;
  progress?: number;
}

export type SystemAction = 'start' | 'stop' | 'reset';

export interface SystemActionResult {
  action: SystemAction;
  status: 'success' | 'failed';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
}

/**
 * Create a new config from Plex credentials (start from scratch)
 */
export async function createFromCredentials(
  plexUrl: string,
  plexToken: string
): Promise<{ analysis: ConfigAnalysis; configYaml: string }> {
  const response = await fetch(`${API_BASE}/config/new`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ plexUrl, plexToken }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Failed to create config');
  }

  return response.json();
}

export interface PlexLibrary {
  key: string;
  title: string;
  type: string;
}

export interface PlexTestResult {
  success: boolean;
  libraries?: PlexLibrary[];
  message?: string;
  error?: string;
}

/**
 * Test Plex connection and get libraries
 */
export async function testPlexConnection(
  plexUrl: string,
  plexToken: string
): Promise<PlexTestResult> {
  const response = await fetch(`${API_BASE}/plex/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ plexUrl, plexToken }),
  });

  const data = await response.json();

  if (!response.ok) {
    return {
      success: false,
      error: data.error || 'Connection failed',
    };
  }

  return data;
}

/**
 * Upload or submit a Kometa config
 */
export async function uploadConfig(configYaml: string): Promise<ConfigAnalysis> {
  const response = await fetch(`${API_BASE}/config`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ configYaml }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Failed to upload config');
  }

  return response.json();
}

/**
 * Get a saved profile
 */
export async function getProfile(profileId: string): Promise<ConfigAnalysis> {
  const response = await fetch(`${API_BASE}/config/${profileId}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Failed to get profile');
  }

  return response.json();
}

/**
 * Start a preview job
 */
export async function startPreview(options: {
  profileId?: string;
  configYaml?: string;
  testOptions?: TestOptions;
}): Promise<{ jobId: string }> {
  const response = await fetch(`${API_BASE}/preview/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Failed to start preview');
  }

  return response.json();
}

/**
 * Get available preview targets
 */
export async function getPreviewTargets(): Promise<{
  targets: Array<{ id: string; label: string; type: string }>;
}> {
  const response = await fetch(`${API_BASE}/preview/targets`);

  if (!response.ok) {
    throw new Error('Failed to get preview targets');
  }

  return response.json();
}

/**
 * Get job status
 */
export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const response = await fetch(`${API_BASE}/preview/status/${jobId}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Failed to get job status');
  }

  return response.json();
}

/**
 * Get job artifacts
 */
export async function getJobArtifacts(jobId: string): Promise<JobArtifacts> {
  const response = await fetch(`${API_BASE}/preview/artifacts/${jobId}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Failed to get artifacts');
  }

  return response.json();
}

/**
 * Subscribe to job events via SSE
 */
export function subscribeToJobEvents(
  jobId: string,
  onEvent: (event: JobEvent) => void,
  onError: (error: Error) => void
): () => void {
  const eventSource = new EventSource(`${API_BASE}/preview/events/${jobId}`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onEvent(data);
    } catch (err) {
      console.error('Failed to parse event:', err);
    }
  };

  eventSource.addEventListener('log', (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      onEvent({ type: 'log', ...data });
    } catch (err) {
      console.error('Failed to parse log event:', err);
    }
  });

  eventSource.addEventListener('progress', (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      onEvent({ type: 'progress', ...data });
    } catch (err) {
      console.error('Failed to parse progress event:', err);
    }
  });

  eventSource.addEventListener('warning', (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      onEvent({ type: 'warning', ...data });
    } catch (err) {
      console.error('Failed to parse warning event:', err);
    }
  });

  eventSource.addEventListener('error', (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      onEvent({ type: 'error', ...data });
    } catch (err) {
      console.error('Failed to parse error event:', err);
    }
  });

  eventSource.addEventListener('complete', (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      onEvent({ type: 'complete', ...data });
      eventSource.close();
    } catch (err) {
      console.error('Failed to parse complete event:', err);
    }
  });

  eventSource.addEventListener('close', () => {
    eventSource.close();
  });

  eventSource.onerror = () => {
    onError(new Error('Connection to event stream lost'));
    eventSource.close();
  };

  // Return cleanup function
  return () => {
    eventSource.close();
  };
}

/**
 * Cancel a job
 */
export async function cancelJob(jobId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/preview/cancel/${jobId}`, {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Failed to cancel job');
  }
}

/**
 * Force delete a stuck job
 * Use this when a job is stuck and won't respond to normal cancellation
 */
export async function forceDeleteJob(jobId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/preview/force/${jobId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Failed to force delete job');
  }
}

/**
 * Pause a running job
 */
export async function pauseJob(jobId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/preview/pause/${jobId}`, {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Failed to pause job');
  }
}

/**
 * Resume a paused job
 */
export async function resumeJob(jobId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/preview/resume/${jobId}`, {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Failed to resume job');
  }
}

/**
 * Get the currently active (running or paused) job
 */
export async function getActiveJob(): Promise<{ hasActiveJob: boolean; job: { jobId: string; status: JobStatusValue; progress: number } | null }> {
  const response = await fetch(`${API_BASE}/preview/active`);

  if (!response.ok) {
    throw new Error('Failed to get active job');
  }

  return response.json();
}

/**
 * Get job logs
 */
export async function getJobLogs(jobId: string): Promise<string> {
  const response = await fetch(`${API_BASE}/preview/logs/${jobId}`);

  if (!response.ok) {
    throw new Error('Failed to get logs');
  }

  return response.text();
}

/**
 * Pagination parameters for job listing
 */
export interface JobListParams {
  page?: number;
  limit?: number;
  status?: JobStatusValue;
}

/**
 * Paginated job list response
 */
export interface PaginatedJobsResponse {
  jobs: JobStatus[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

/**
 * List jobs with pagination support
 * @param params - Optional pagination parameters (page, limit, status filter)
 */
export async function listJobs(params?: JobListParams): Promise<PaginatedJobsResponse> {
  const searchParams = new URLSearchParams();

  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.status) searchParams.set('status', params.status);

  const queryString = searchParams.toString();
  const url = `${API_BASE}/preview/jobs${queryString ? `?${queryString}` : ''}`;

  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Failed to list jobs');
  }

  return response.json();
}

/**
 * Health check
 */
export async function checkHealth(): Promise<{ status: string; version: string }> {
  const response = await fetch(`${API_BASE}/health`);

  if (!response.ok) {
    throw new Error('Backend is not available');
  }

  return response.json();
}

/**
 * Trigger a system action (start/stop/reset).
 */
export async function runSystemAction(action: SystemAction): Promise<SystemActionResult> {
  const response = await fetch(`${API_BASE}/system/${action}`, {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Failed to run system action');
  }

  return response.json();
}

/**
 * Builder API - Get overlay configurations from profile
 */
export async function getBuilderOverlays(profileId: string): Promise<{
  profileId: string;
  overlaysByLibrary: Record<string, Array<string | Record<string, unknown>>>;
  libraryNames: string[];
}> {
  const response = await fetch(`${API_BASE}/builder/overlays/${profileId}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Failed to get overlays');
  }

  return response.json();
}

/**
 * Builder API - Save overlay configurations to profile
 */
export async function saveBuilderOverlays(
  profileId: string,
  overlaysByLibrary: Record<string, Array<string | Record<string, unknown>>>
): Promise<{ success: boolean; profileId: string; message: string }> {
  const response = await fetch(`${API_BASE}/builder/overlays/${profileId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ overlaysByLibrary }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Failed to save overlays');
  }

  return response.json();
}

/**
 * Builder API - Export builder configuration
 */
export async function exportBuilderConfig(config: {
  enabledOverlays: Record<string, boolean>;
  selectedPreset: string | null;
  advancedOverlays: unknown[];
  advancedQueues: unknown[];
}): Promise<unknown> {
  const response = await fetch(`${API_BASE}/builder/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Failed to export config');
  }

  return response.json();
}

/**
 * Builder API - Import and validate builder configuration
 */
export async function importBuilderConfig(data: unknown): Promise<{
  valid: boolean;
  data: {
    enabledOverlays: Record<string, boolean>;
    selectedPreset: string;
    advancedOverlays: unknown[];
    advancedQueues: unknown[];
  };
}> {
  const response = await fetch(`${API_BASE}/builder/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Failed to import config');
  }

  return response.json();
}

// ============================================================================
// Community Configs API
// ============================================================================

export interface CommunityContributor {
  username: string;
  path: string;
  configCount: number;
}

export interface CommunityConfig {
  name: string;
  path: string;
  downloadUrl?: string;
  size: number;
}

/**
 * Get list of all community contributors
 */
export async function getCommunityContributors(): Promise<{
  contributors: CommunityContributor[];
  total: number;
  cached?: boolean;
}> {
  const response = await fetch(`${API_BASE}/community/contributors-with-overlays`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch contributors' }));
    throw new Error(error.details || error.error || 'Failed to fetch contributors');
  }

  return response.json();
}

/**
 * Get configs from a specific contributor
 */
export async function getContributorConfigs(username: string): Promise<{
  username: string;
  configs: CommunityConfig[];
  total: number;
}> {
  const response = await fetch(`${API_BASE}/community/contributor/${username}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch contributor configs' }));
    throw new Error(error.details || error.error || 'Failed to fetch contributor configs');
  }

  return response.json();
}

/**
 * Get raw config file content from a community contributor
 */
export async function getCommunityConfig(
  username: string,
  filename: string
): Promise<{
  username: string;
  filename: string;
  content: string;
  url: string;
}> {
  const response = await fetch(`${API_BASE}/community/config/${username}/${filename}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch config' }));
    throw new Error(error.details || error.error || 'Failed to fetch config');
  }

  return response.json();
}

/**
 * Parse overlay configurations from YAML content
 */
export async function parseCommunityOverlays(yamlContent: string): Promise<{
  success: boolean;
  overlays: string[];
  libraryCount: number;
}> {
  const response = await fetch(`${API_BASE}/community/parse-overlays`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ yamlContent }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to parse overlays' }));
    throw new Error(error.details || error.error || 'Failed to parse overlays');
  }

  return response.json();
}

// ============================================================================
// Sharing API
// ============================================================================

export interface ShareMetadata {
  title?: string;
  description?: string;
  author?: string;
  createdAt?: string;
}

export interface ShareConfig {
  enabledOverlays: Record<string, boolean>;
  selectedPreset: string | null;
  advancedOverlays: unknown[];
  advancedQueues: unknown[];
}

export interface ShareResponse {
  success: boolean;
  shareId: string;
  shareUrl: string;
}

export interface SharedConfigResponse {
  success: boolean;
  id: string;
  config: ShareConfig;
  metadata: ShareMetadata;
}

export interface GistResponse {
  success: boolean;
  gistId: string;
  gistUrl: string;
  rawUrl: string;
}

/**
 * Create a shareable link for an overlay configuration
 */
export async function createShare(
  config: ShareConfig,
  metadata?: ShareMetadata
): Promise<ShareResponse> {
  const response = await fetch(`${API_BASE}/share/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ config, metadata }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to create share' }));
    throw new Error(error.details || error.error || 'Failed to create share');
  }

  return response.json();
}

/**
 * Get a shared configuration by ID
 */
export async function getShare(shareId: string): Promise<SharedConfigResponse> {
  const response = await fetch(`${API_BASE}/share/${shareId}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to get share' }));
    throw new Error(error.details || error.error || 'Failed to get share');
  }

  return response.json();
}

/**
 * Export configuration to GitHub Gist
 */
export async function exportToGist(
  config: ShareConfig,
  metadata?: ShareMetadata,
  githubToken?: string
): Promise<GistResponse> {
  const response = await fetch(`${API_BASE}/share/gist`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ config, metadata, githubToken }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to create gist' }));
    throw new Error(error.details || error.error || 'Failed to create gist');
  }

  return response.json();
}

/**
 * Import configuration from GitHub Gist
 */
export async function importFromGist(gistId: string): Promise<SharedConfigResponse> {
  const response = await fetch(`${API_BASE}/share/gist/${gistId}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to import gist' }));
    throw new Error(error.details || error.error || 'Failed to import gist');
  }

  return response.json();
}
