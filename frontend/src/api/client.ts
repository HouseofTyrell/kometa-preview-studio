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
}

// Job status values - must match backend/src/constants.ts
export type JobStatusValue = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

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
 * List all jobs
 */
export async function listJobs(): Promise<{ jobs: JobStatus[] }> {
  const response = await fetch(`${API_BASE}/preview/jobs`);

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
