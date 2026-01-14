import { Router, Request, Response } from 'express';
import { getJobManager } from '../jobs/jobManager.js';
import { profiles } from './configUpload.js';
import { TestOptions, DEFAULT_TEST_OPTIONS } from '../types/testOptions.js';
import { getAvailableTargets } from '../plex/resolveTargets.js';

const router = Router();

/**
 * POST /api/preview/start
 * Start a new preview job
 */
router.post('/start', async (req: Request, res: Response) => {
  try {
    const { profileId, configYaml: directConfigYaml, testOptions } = req.body;

    let configYaml: string;

    // Get config from profile or direct submission
    if (profileId) {
      const profile = profiles.get(profileId);
      if (!profile) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }
      configYaml = profile.configYaml;
    } else if (directConfigYaml) {
      configYaml = directConfigYaml;
    } else {
      res.status(400).json({
        error: 'Either profileId or configYaml is required',
      });
      return;
    }

    // Parse test options with defaults
    const options: TestOptions = testOptions
      ? { ...DEFAULT_TEST_OPTIONS, ...testOptions }
      : DEFAULT_TEST_OPTIONS;

    // Create job with test options
    const jobManager = getJobManager();
    const jobId = await jobManager.createJob(configYaml, options);

    res.json({
      jobId,
      message: 'Preview job created',
      eventsUrl: `/api/preview/events/${jobId}`,
      statusUrl: `/api/preview/status/${jobId}`,
    });

  } catch (err) {
    console.error('Preview start error:', err);
    res.status(500).json({
      error: 'Failed to start preview',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/preview/targets
 * Get available preview targets
 */
router.get('/targets', (_req: Request, res: Response) => {
  const targets = getAvailableTargets();
  res.json({ targets });
});

export default router;
