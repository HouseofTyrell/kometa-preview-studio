import { Router, Request, Response } from 'express';
import { getJobManager } from '../jobs/jobManager.js';

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
    console.error('Status error:', err);
    res.status(500).json({
      error: 'Failed to get job status',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

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
  res.write(`event: connected\ndata: ${JSON.stringify({ jobId })}\n\n`);

  // Listen for job events
  const eventHandler = (event: { type: string; timestamp: Date; message: string; data?: Record<string, unknown> }) => {
    const eventData = {
      type: event.type,
      timestamp: event.timestamp.toISOString(),
      message: event.message,
      ...event.data,
    };

    res.write(`event: ${event.type}\ndata: ${JSON.stringify(eventData)}\n\n`);

    // Close connection on complete or error
    if (event.type === 'complete' || event.type === 'error') {
      setTimeout(() => {
        res.write('event: close\ndata: {}\n\n');
        res.end();
      }, 100);
    }
  };

  jobManager.on(`job:${jobId}`, eventHandler);

  // Handle client disconnect
  req.on('close', () => {
    jobManager.off(`job:${jobId}`, eventHandler);
  });

  // Send heartbeat every 30 seconds
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
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
    console.error('Cancel error:', err);
    res.status(500).json({
      error: 'Failed to cancel job',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/preview/jobs
 * List all jobs
 */
router.get('/jobs', async (req: Request, res: Response) => {
  try {
    const jobManager = getJobManager();
    const jobs = await jobManager.listJobs();

    res.json({
      jobs: jobs.map((job) => ({
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        error: job.error,
      })),
    });

  } catch (err) {
    console.error('List jobs error:', err);
    res.status(500).json({
      error: 'Failed to list jobs',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;
