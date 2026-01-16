import { Router, Request, Response } from 'express';
import { getJobManager } from '../jobs/jobManager.js';
import { SSE_HEARTBEAT_INTERVAL_MS, SSE_CLOSE_DELAY_MS } from '../constants.js';
import { PREVIEW_TARGETS } from '../plex/resolveTargets.js';
import { apiLogger } from '../util/logger.js';

const router = Router();

/**
 * GET /api/preview/status/:jobId
 * Get the current status of a preview job
 */
router.get('/status/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const jobManager = getJobManager();

    const meta = await jobManager.getJobMeta(jobId);

    if (!meta) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    // Extract all warnings from targets
    const warnings: string[] = [];
    for (const target of meta.targets) {
      warnings.push(...target.warnings);
    }

    res.json({
      jobId: meta.jobId,
      status: meta.status,
      progress: meta.progress,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      completedAt: meta.completedAt,
      exitCode: meta.exitCode,
      error: meta.error,
      warnings,
      targets: meta.targets.map((t) => ({
        id: t.id,
        title: t.title,
        baseSource: t.baseSource,
        hasWarnings: t.warnings.length > 0,
      })),
    });

  } catch (err) {
    apiLogger.error({ err }, 'Status error');
    res.status(500).json({
      error: 'Failed to get job status',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * Safely write to SSE response, checking if connection is still open
 */
function safeSSEWrite(res: Response, data: string): boolean {
  if (res.writableEnded || res.destroyed) {
    return false;
  }
  try {
    res.write(data);
    return true;
  } catch {
    return false;
  }
}

/**
 * GET /api/preview/events/:jobId
 * SSE stream of job events
 */
router.get('/events/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const jobManager = getJobManager();

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  // Send initial connection event
  safeSSEWrite(res, `event: connected\ndata: ${JSON.stringify({ jobId })}\n\n`);

  // Listen for job events
  const eventHandler = (event: { type: string; timestamp: Date; message: string; data?: Record<string, unknown> }) => {
    const eventData = {
      type: event.type,
      timestamp: event.timestamp.toISOString(),
      message: event.message,
      ...event.data,
    };

    safeSSEWrite(res, `event: ${event.type}\ndata: ${JSON.stringify(eventData)}\n\n`);

    // Close connection on complete or error
    if (event.type === 'complete' || event.type === 'error') {
      setTimeout(() => {
        if (safeSSEWrite(res, 'event: close\ndata: {}\n\n')) {
          res.end();
        }
      }, SSE_CLOSE_DELAY_MS);
    }
  };

  jobManager.on(`job:${jobId}`, eventHandler);

  // Send heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    if (!safeSSEWrite(res, ': heartbeat\n\n')) {
      clearInterval(heartbeat);
    }
  }, SSE_HEARTBEAT_INTERVAL_MS);

  // Handle client disconnect - single listener for cleanup
  req.on('close', () => {
    jobManager.off(`job:${jobId}`, eventHandler);
    clearInterval(heartbeat);
  });
});

/**
 * POST /api/preview/cancel/:jobId
 * Cancel a running or queued job
 */
router.post('/cancel/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const jobManager = getJobManager();

    const cancelled = await jobManager.cancelJob(jobId);

    if (cancelled) {
      res.json({ success: true, message: 'Job cancelled' });
    } else {
      res.status(400).json({
        success: false,
        message: 'Job could not be cancelled (may already be completed)',
      });
    }

  } catch (err) {
    apiLogger.error({ err }, 'Cancel error');
    res.status(500).json({
      error: 'Failed to cancel job',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/preview/force/:jobId
 * Force delete a stuck job by marking it as failed
 * Use this when a job is stuck in "running" state and won't respond to cancel
 */
router.delete('/force/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const jobManager = getJobManager();

    const forced = await jobManager.forceFailJob(jobId);

    if (forced) {
      res.json({ success: true, message: 'Job forcefully marked as failed' });
    } else {
      res.status(404).json({
        success: false,
        message: 'Job not found',
      });
    }

  } catch (err) {
    apiLogger.error({ err }, 'Force delete error');
    res.status(500).json({
      error: 'Failed to force delete job',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/preview/pause/:jobId
 * Pause a running job
 */
router.post('/pause/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const jobManager = getJobManager();

    const paused = await jobManager.pauseJob(jobId);

    if (paused) {
      res.json({ success: true, message: 'Job paused' });
    } else {
      res.status(400).json({
        success: false,
        message: 'Job could not be paused (may not be running)',
      });
    }

  } catch (err) {
    apiLogger.error({ err }, 'Pause error');
    res.status(500).json({
      error: 'Failed to pause job',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/preview/resume/:jobId
 * Resume a paused job
 */
router.post('/resume/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const jobManager = getJobManager();

    const resumed = await jobManager.resumeJob(jobId);

    if (resumed) {
      res.json({ success: true, message: 'Job resumed' });
    } else {
      res.status(400).json({
        success: false,
        message: 'Job could not be resumed (may not be paused)',
      });
    }

  } catch (err) {
    apiLogger.error({ err }, 'Resume error');
    res.status(500).json({
      error: 'Failed to resume job',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/preview/active
 * Get the currently active (running or paused) job
 */
router.get('/active', async (req: Request, res: Response) => {
  try {
    const jobManager = getJobManager();
    const activeJob = await jobManager.getActiveJob();

    if (activeJob) {
      res.json({
        hasActiveJob: true,
        job: {
          jobId: activeJob.jobId,
          status: activeJob.status,
          progress: activeJob.progress,
          createdAt: activeJob.createdAt,
          updatedAt: activeJob.updatedAt,
        },
      });
    } else {
      res.json({ hasActiveJob: false, job: null });
    }

  } catch (err) {
    apiLogger.error({ err }, 'Get active job error');
    res.status(500).json({
      error: 'Failed to get active job',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/preview/jobs
 * List all jobs with pagination support
 *
 * Query parameters:
 * - page: Page number (1-indexed, default: 1)
 * - limit: Items per page (default: 20, max: 100)
 * - status: Filter by status (optional)
 */
router.get('/jobs', async (req: Request, res: Response) => {
  try {
    const jobManager = getJobManager();

    // Parse pagination parameters
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const statusFilter = req.query.status as string | undefined;

    // Get all jobs (already sorted by createdAt descending)
    let allJobs = await jobManager.listJobs();

    // Apply status filter if provided
    if (statusFilter) {
      allJobs = allJobs.filter(job => job.status === statusFilter);
    }

    const total = allJobs.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;

    // Slice for pagination
    const paginatedJobs = allJobs.slice(offset, offset + limit);

    res.json({
      jobs: paginatedJobs.map((job) => ({
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        error: job.error,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });

  } catch (err) {
    apiLogger.error({ err }, 'List jobs error');
    res.status(500).json({
      error: 'Failed to list jobs',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/preview/targets
 * Get available preview targets (single source of truth)
 * Frontend should fetch this instead of hardcoding targets
 */
router.get('/targets', (_req: Request, res: Response) => {
  // Transform backend targets to frontend-compatible format
  const targets = PREVIEW_TARGETS.map((t) => ({
    id: t.id,
    label: t.label.replace(/ — .*$/, ''), // Strip type suffix from label
    type: t.type,
    displayType: getDisplayType(t.type, t.seasonIndex, t.episodeIndex),
    metadata: t.metadata,
  }));

  res.json({ targets });
});

/**
 * Get human-readable display type for a target
 */
function getDisplayType(type: string, seasonIndex?: number, episodeIndex?: number): string {
  switch (type) {
    case 'movie':
      return 'Movie';
    case 'show':
      return 'Series';
    case 'season':
      return `Season ${seasonIndex || 1}`;
    case 'episode':
      return `S${String(seasonIndex || 1).padStart(2, '0')}E${String(episodeIndex || 1).padStart(2, '0')}`;
    default:
      return type;
  }
}

export default router;
