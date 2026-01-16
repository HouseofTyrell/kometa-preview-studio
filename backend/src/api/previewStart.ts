import { Router, Request, Response } from 'express';
import { getJobManager } from '../jobs/jobManager.js';
import { getProfileStore } from '../storage/profileStore.js';
import { TestOptions, DEFAULT_TEST_OPTIONS } from '../types/testOptions.js';
import { getAvailableTargets } from '../plex/resolveTargets.js';
import { jobLogger } from '../util/logger.js';

const router = Router();

/**
 * POST /api/preview/start
 * Start a new preview job
 */
router.post('/start', async (req: Request, res: Response) => {
  try {
    const { profileId, configYaml: directConfigYaml, testOptions } = req.body;

    // Validate input types
    if (profileId !== undefined && typeof profileId !== 'string') {
      res.status(400).json({ error: 'profileId must be a string' });
      return;
    }
    if (directConfigYaml !== undefined && typeof directConfigYaml !== 'string') {
      res.status(400).json({ error: 'configYaml must be a string' });
      return;
    }
    if (testOptions !== undefined && typeof testOptions !== 'object') {
      res.status(400).json({ error: 'testOptions must be an object' });
      return;
    }

    let configYaml: string;

    // Get config from profile or direct submission
    if (profileId) {
      const store = getProfileStore();
      const profile = store.get(profileId);
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

    // Debug: Log manual builder config
    jobLogger.debug({ manualBuilderConfig: options.manualBuilderConfig }, 'Preview start - manual builder config');

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
    jobLogger.error({ err }, 'Preview start error');
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
