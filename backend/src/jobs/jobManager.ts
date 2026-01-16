import * as path from 'path';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { getJobPaths, getJobsBasePath, getJobsHostPath, getFontsPath, getFontsHostPath, getKometaRendererImage, getUserPaths, getCacheHostPath, getOverlayAssetsHostPath } from './paths.js';
import { ensureDir, writeText, writeJson } from '../util/safeFs.js';
import { KometaRunner, RunnerConfig, RunnerEvent } from '../kometa/runner.js';
import { parseYaml, analyzeConfig, KometaConfig } from '../util/yaml.js';
import { PlexClient } from '../plex/plexClient.js';
import { resolveTargets, ResolvedTarget } from '../plex/resolveTargets.js';
import { fetchArtwork } from '../plex/fetchArtwork.js';
import { createTmdbClient } from '../plex/tmdbClient.js';
import { generatePreviewConfig } from '../kometa/configGenerator.js';
import { TestOptions, DEFAULT_TEST_OPTIONS } from '../types/testOptions.js';
import { JobRepository, JobMeta, JobTarget, JobStatus } from './jobRepository.js';
import { ArtifactManager, JobArtifacts } from './artifactManager.js';
import { jobLogger } from '../util/logger.js';

// Re-export types for backwards compatibility
export type { JobStatus, JobTarget, JobMeta } from './jobRepository.js';
export type { JobArtifacts } from './artifactManager.js';

/**
 * Job Manager - Orchestrates preview jobs
 *
 * This class coordinates job execution by delegating to:
 * - JobRepository: Job metadata persistence
 * - ArtifactManager: Artifact (image/log) retrieval
 * - KometaRunner: Container execution
 */
class JobManager extends EventEmitter {
  private runner: KometaRunner;
  private repository: JobRepository;
  private artifacts: ArtifactManager;

  constructor() {
    super();

    // Initialize extracted services
    this.repository = new JobRepository();
    this.artifacts = new ArtifactManager();

    const runnerConfig: RunnerConfig = {
      kometaImage: getKometaRendererImage(),
      jobsBasePath: getJobsBasePath(),
      jobsHostPath: getJobsHostPath(),
      fontsPath: getFontsPath(),
      fontsHostPath: getFontsHostPath(),
      cacheHostPath: getCacheHostPath(),
      overlayAssetsHostPath: getOverlayAssetsHostPath(),
      ...getUserPaths(),
    };

    this.runner = new KometaRunner(runnerConfig);

    // Forward runner events
    this.runner.on('job', (event: { jobId: string } & RunnerEvent) => {
      this.emit(`job:${event.jobId}`, event);
      this.updateJobFromEvent(event.jobId, event);
    });
  }

  /**
   * Pre-pull the Docker image during server startup
   * This prevents the first preview job from being blocked by image pull
   *
   * @param onProgress - Optional callback for pull progress updates
   * @returns true if image was pulled, false if already available
   */
  async prePullDockerImage(onProgress?: (message: string) => void): Promise<boolean> {
    return this.runner.prePullImage(onProgress);
  }

  /**
   * Check if Docker is available
   */
  async checkDockerAvailable(): Promise<boolean> {
    return this.runner.checkDockerAvailable();
  }

  /**
   * Create a new preview job from config YAML
   * @param configYaml - The Kometa configuration YAML
   * @param testOptions - Optional test options for selective testing
   */
  async createJob(configYaml: string, testOptions?: TestOptions): Promise<string> {
    const jobId = uuidv4();
    const paths = getJobPaths(jobId);

    jobLogger.info({ jobId, manualMode: testOptions?.manualBuilderConfig?.enabled }, 'Creating new job');

    // Parse and validate config
    const parseResult = parseYaml(configYaml);
    if (parseResult.error || !parseResult.parsed) {
      jobLogger.error({ error: parseResult.error }, 'Config parse error');
      throw new Error(`Invalid config: ${parseResult.error}`);
    }

    const config = parseResult.parsed as KometaConfig;
    const analysis = analyzeConfig(config);

    // Skip Plex validation in manual mode
    if (!testOptions?.manualBuilderConfig?.enabled) {
      // Check for Plex connection - validate and extract for type safety
      const plexUrl = analysis.plexUrl;
      const plexToken = config.plex?.token;
      if (!plexUrl || !plexToken) {
        throw new Error('Plex URL and token are required in config');
      }
    }

    // Create job directories
    await ensureDir(paths.inputDir);
    await ensureDir(paths.outputDir);
    await ensureDir(paths.configDir);
    await ensureDir(paths.logsDir);

    // Use provided test options or defaults
    const options = testOptions || DEFAULT_TEST_OPTIONS;

    // Initialize job metadata
    const jobMeta: JobMeta = {
      jobId,
      status: 'pending',
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      targets: [],
      warnings: [...analysis.warnings],
    };

    this.repository.setInCache(jobId, jobMeta);
    await this.repository.saveJobMeta(jobId, jobMeta);

    // Emit job creation event
    this.emit(`job:${jobId}`, {
      type: 'log',
      timestamp: new Date(),
      message: `Job created: ${jobId}`,
    });

    // Start job processing in background
    this.processJob(jobId, config, analysis, options).catch((err) => {
      jobLogger.error({ jobId, err }, 'Job failed');
      this.updateJobStatus(jobId, 'failed', 0, err.message).catch((updateErr) => {
        jobLogger.error({ jobId, err: updateErr }, 'Failed to update job status');
      });
    });

    return jobId;
  }

  /**
   * Process a job - resolve targets, fetch artwork, run renderer
   * @param jobId - The job ID
   * @param config - The parsed Kometa config
   * @param analysis - The config analysis results
   * @param testOptions - Test options for selective testing
   */
  private async processJob(
    jobId: string,
    config: KometaConfig,
    analysis: ReturnType<typeof analyzeConfig>,
    testOptions: TestOptions
  ): Promise<void> {
    const paths = getJobPaths(jobId);

    try {
      // Update status to running
      await this.updateJobStatus(jobId, 'running', 5);

      // Check if manual builder mode is enabled
      const isManualMode = testOptions.manualBuilderConfig?.enabled;

      // Skip Plex connection in manual mode (uses hardcoded metadata)
      if (!isManualMode) {
        this.emit(`job:${jobId}`, {
          type: 'progress',
          timestamp: new Date(),
          message: 'Connecting to Plex...',
          data: { progress: 5 },
        });

        // Validate required Plex configuration
        const plexUrl = analysis.plexUrl;
        const plexToken = config.plex?.token;
        if (!plexUrl || !plexToken) {
          throw new Error('Plex URL and token are required in config');
        }
      }

      // Create Plex client
      // CRITICAL: Kometa/Plex configs specify timeout in SECONDS, but PlexClient uses MILLISECONDS.
      // Without this conversion, a config with "timeout: 60" would be interpreted as 60ms instead
      // of 60 seconds, causing immediate timeouts when searching for movies in Plex.
      // This bug caused all Plex searches to fail with "Plex request timeout" errors.
      const plexClient = new PlexClient({
        url: analysis.plexUrl || 'http://localhost:32400',
        token: config.plex?.token || 'dummy-token',
        timeout: config.plex?.timeout ? config.plex.timeout * 1000 : undefined,
      });

      // Test connection only if not in manual mode
      if (!isManualMode) {
        await plexClient.testConnection();
        this.emit(`job:${jobId}`, {
          type: 'log',
          timestamp: new Date(),
          message: 'Plex connection successful',
        });
      } else {
        this.emit(`job:${jobId}`, {
          type: 'log',
          timestamp: new Date(),
          message: 'Manual mode enabled - using hardcoded metadata',
        });
      }

      // Resolve targets (filtered by test options)
      await this.updateJobStatus(jobId, 'running', 15);
      this.emit(`job:${jobId}`, {
        type: 'progress',
        timestamp: new Date(),
        message: 'Resolving preview targets...',
        data: { progress: 15 },
      });

      const targets = await resolveTargets(plexClient, testOptions);

      if (targets.length === 0) {
        throw new Error('No targets selected for preview. Please select at least one target or media type.');
      }

      // CRITICAL: Validate that all targets have ratingKeys from Plex.
      // The ratingKey is essential for the Plex proxy filtering in the renderer container.
      // Without valid ratingKeys, the proxy cannot filter library responses, causing Kometa
      // to scan the ENTIRE Plex library (e.g., 2000+ movies) instead of just the 2-5 preview
      // targets. This turns a 30-second preview into a 15+ minute operation.
      //
      // If targets don't have ratingKeys, it means either:
      // 1. The movies don't exist in the user's Plex library
      // 2. The Plex search failed (timeout, connection issue, etc.)
      // 3. The search title didn't match any items
      //
      // We fail fast here to avoid wasting time on an unfiltered Kometa run.
      const targetsWithoutRatingKey = targets.filter(t => !t.ratingKey);
      if (targetsWithoutRatingKey.length > 0) {
        const missing = targetsWithoutRatingKey.map(t => `"${t.label}"`).join(', ');
        // Collect warnings to help debug why items weren't found
        const allWarnings = targetsWithoutRatingKey
          .flatMap(t => t.warnings)
          .filter(w => w);
        const warningDetails = allWarnings.length > 0
          ? ` Errors: ${allWarnings.join('; ')}`
          : '';
        throw new Error(
          `Could not find the following items in your Plex library: ${missing}.${warningDetails} ` +
          `Please ensure these titles exist in Plex and try again.`
        );
      }

      this.emit(`job:${jobId}`, {
        type: 'log',
        timestamp: new Date(),
        message: `Resolved ${targets.length} target(s) for preview`,
      });

      // Fetch artwork
      await this.updateJobStatus(jobId, 'running', 30);
      this.emit(`job:${jobId}`, {
        type: 'progress',
        timestamp: new Date(),
        message: 'Fetching artwork...',
        data: { progress: 30 },
      });

      // Create TMDb client if API key is available in config
      const tmdbConfig = config.tmdb as Record<string, unknown> | undefined;
      const tmdbClient = tmdbConfig ? createTmdbClient(tmdbConfig as { apikey?: string }) : null;

      if (tmdbClient) {
        this.emit(`job:${jobId}`, {
          type: 'log',
          timestamp: new Date(),
          message: 'TMDb API available - will fetch clean posters',
        });
      }

      const artwork = await fetchArtwork(plexClient, targets, {
        assetDirectories: analysis.assetDirectories,
        originalPostersDir: getUserPaths().userKometaConfigPath
          ? path.join(getUserPaths().userKometaConfigPath!, 'Original Posters')
          : null,
        inputDir: paths.inputDir,
        tmdbClient,
      });

      // Update job targets
      const jobTargets: JobTarget[] = targets.map((t, i) => ({
        id: t.id,
        title: t.actualTitle,
        type: t.type,
        baseSource: artwork[i]?.source || 'plex_current',
        warnings: [...t.warnings, ...(artwork[i]?.warnings || [])],
      }));

      const currentMeta = this.repository.getFromCache(jobId)!;
      currentMeta.targets = jobTargets;
      await this.repository.saveJobMeta(jobId, currentMeta);

      // Log any warnings about artwork sources
      for (const art of artwork) {
        if (art.source === 'plex_current') {
          this.emit(`job:${jobId}`, {
            type: 'log',
            timestamp: new Date(),
            message: `Warning: Using Plex current artwork for ${art.targetId} (may contain existing overlays)`,
          });
        }
      }

      // Generate preview config
      await this.updateJobStatus(jobId, 'running', 45);
      this.emit(`job:${jobId}`, {
        type: 'progress',
        timestamp: new Date(),
        message: 'Generating preview configuration...',
        data: { progress: 45 },
      });

      const generated = generatePreviewConfig(
        config,
        targets,
        artwork,
        {
          inputDir: paths.inputDir,
          outputDir: paths.outputDir,
          configDir: paths.configDir,
        },
        testOptions
      );

      // Write preview config
      await writeText(path.join(paths.configDir, 'preview.yml'), generated.configYaml);

      // Write metadata for the renderer
      await writeJson(paths.metaFile, {
        jobId,
        items: Object.fromEntries(
          targets.map((t, i) => [
            t.id,
            {
              type: t.type,
              title: t.actualTitle,
              baseSource: artwork[i]?.source,
              ...getItemMetadata(t),
            },
          ])
        ),
      });

      // Run the Kometa renderer
      await this.updateJobStatus(jobId, 'running', 50);
      this.emit(`job:${jobId}`, {
        type: 'progress',
        timestamp: new Date(),
        message: 'Starting Kometa renderer...',
        data: { progress: 50 },
      });

      const result = await this.runner.run({
        jobId,
        configYaml: generated.configYaml,
        rendererScript: '', // Not used with Kometa renderer
      });

      // Check result
      if (result.exitCode === 0) {
        await this.updateJobStatus(jobId, 'completed', 100);
        this.emit(`job:${jobId}`, {
          type: 'complete',
          timestamp: new Date(),
          message: 'Preview rendering completed successfully',
          data: { progress: 100, exitCode: 0 },
        });
      } else {
        await this.updateJobStatus(jobId, 'failed', 100, `Renderer exited with code ${result.exitCode}`);
        this.emit(`job:${jobId}`, {
          type: 'error',
          timestamp: new Date(),
          message: `Renderer failed with exit code ${result.exitCode}`,
          data: { progress: 100, exitCode: result.exitCode },
        });
      }

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await this.updateJobStatus(jobId, 'failed', 0, message);
      this.emit(`job:${jobId}`, {
        type: 'error',
        timestamp: new Date(),
        message: `Job failed: ${message}`,
      });
      throw err;
    }
  }

  /**
   * Get job metadata
   * Delegates to JobRepository
   */
  async getJobMeta(jobId: string): Promise<JobMeta | null> {
    return this.repository.getJobMeta(jobId);
  }

  /**
   * Get job artifacts (before/after images)
   * Delegates to ArtifactManager
   */
  async getJobArtifacts(jobId: string): Promise<JobArtifacts | null> {
    const meta = await this.getJobMeta(jobId);
    if (!meta) {
      return null;
    }
    return this.artifacts.getJobArtifacts(jobId, meta);
  }

  /**
   * Get path to an image file
   * Delegates to ArtifactManager
   */
  getImagePath(jobId: string, folder: 'input' | 'output', filename: string): string | null {
    return this.artifacts.getImagePath(jobId, folder, filename);
  }

  /**
   * Get path to log file
   * Delegates to ArtifactManager
   */
  getLogPath(jobId: string): string {
    return this.artifacts.getLogPath(jobId);
  }

  /**
   * Cancel a running job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const meta = this.repository.getFromCache(jobId);
    if (!meta || (meta.status !== 'running' && meta.status !== 'paused')) {
      return false;
    }

    const cancelled = await this.runner.cancel(jobId);
    if (cancelled) {
      await this.updateJobStatus(jobId, 'cancelled', meta.progress);
    }

    return cancelled;
  }

  /**
   * Pause a running job
   */
  async pauseJob(jobId: string): Promise<boolean> {
    const meta = this.repository.getFromCache(jobId);
    if (!meta || meta.status !== 'running') {
      return false;
    }

    const paused = await this.runner.pause(jobId);
    if (paused) {
      await this.updateJobStatus(jobId, 'paused', meta.progress);
      this.emit(`job:${jobId}`, {
        type: 'progress',
        timestamp: new Date(),
        message: 'Job paused',
        data: { progress: meta.progress, paused: true },
      });
    }

    return paused;
  }

  /**
   * Resume a paused job
   */
  async resumeJob(jobId: string): Promise<boolean> {
    const meta = this.repository.getFromCache(jobId);
    if (!meta || meta.status !== 'paused') {
      return false;
    }

    const resumed = await this.runner.resume(jobId);
    if (resumed) {
      await this.updateJobStatus(jobId, 'running', meta.progress);
      this.emit(`job:${jobId}`, {
        type: 'progress',
        timestamp: new Date(),
        message: 'Job resumed',
        data: { progress: meta.progress, paused: false },
      });
    }

    return resumed;
  }

  /**
   * Force fail a stuck job
   * This forcefully marks a job as failed without waiting for container cleanup
   * Use this when a job is stuck and won't respond to normal cancellation
   */
  async forceFailJob(jobId: string): Promise<boolean> {
    const meta = this.repository.getFromCache(jobId);
    if (!meta) {
      return false;
    }

    // Only force-fail jobs that are in problematic states
    if (meta.status !== 'running' && meta.status !== 'paused' && meta.status !== 'pending') {
      return false;
    }

    // Try to cancel the container if it exists
    try {
      await this.runner.cancel(jobId);
    } catch (err) {
      // Ignore errors - we're forcing this to fail regardless
      jobLogger.warn({ jobId, err }, 'Force fail: Could not cancel container');
    }

    // Update status to failed
    await this.updateJobStatus(jobId, 'failed', 100);
    meta.error = 'Job forcefully terminated by user';
    meta.completedAt = new Date().toISOString();

    // Update job meta file
    await this.repository.saveJobMeta(jobId, meta);

    this.emit(`job:${jobId}`, {
      type: 'error',
      timestamp: new Date(),
      message: 'Job forcefully terminated',
      data: { error: meta.error },
    });

    return true;
  }

  /**
   * Get the currently active job (running or paused)
   * Delegates to JobRepository
   */
  async getActiveJob(): Promise<JobMeta | null> {
    return this.repository.getActiveJob();
  }

  /**
   * List all jobs
   * Delegates to JobRepository
   */
  async listJobs(): Promise<JobMeta[]> {
    return this.repository.listJobs();
  }

  /**
   * Update job status
   * Delegates to JobRepository
   */
  private async updateJobStatus(jobId: string, status: JobStatus, progress: number, error?: string): Promise<void> {
    await this.repository.updateStatus(jobId, status, progress, error);
  }

  /**
   * Update job from runner event
   */
  private updateJobFromEvent(jobId: string, event: RunnerEvent): void {
    const meta = this.repository.getFromCache(jobId);
    if (!meta) {
      return;
    }

    if (event.data?.progress !== undefined) {
      meta.progress = event.data.progress as number;
    }

    if (event.data?.exitCode !== undefined) {
      meta.exitCode = event.data.exitCode as number;
    }

    if (event.type === 'complete') {
      meta.status = 'completed';
      meta.completedAt = new Date().toISOString();
    } else if (event.type === 'error') {
      meta.status = 'failed';
      meta.completedAt = new Date().toISOString();
      meta.error = event.message;
    }

    meta.updatedAt = new Date().toISOString();
    this.repository.saveJobMeta(jobId, meta).catch((err) => {
      jobLogger.error({ jobId, err }, 'Failed to save job metadata');
    });
  }
}

/**
 * Get additional metadata for items
 */
function getItemMetadata(target: ResolvedTarget): Record<string, unknown> {
  const meta: Record<string, unknown> = {};

  // Add type-specific metadata used by the renderer
  switch (target.type) {
    case 'movie':
      if (target.id === 'dune') {
        meta.resolution = '4K';
        meta.audio_codec = 'Atmos';
        meta.hdr = true;
      } else if (target.id === 'matrix') {
        meta.resolution = '1080p';
        meta.audio_codec = 'DTS-HD';
      }
      meta.year = target.searchYear;
      break;

    case 'show':
      meta.rating = '9.5';
      meta.status = 'COMPLETED';
      break;

    case 'season':
      meta.season_index = target.seasonIndex || 1;
      break;

    case 'episode':
      meta.season_index = target.seasonIndex || 1;
      meta.episode_index = target.episodeIndex || 1;
      meta.runtime = '58 min';
      break;
  }

  return meta;
}

// Singleton instance
let jobManagerInstance: JobManager | null = null;

/**
 * Get the singleton JobManager instance
 */
export function getJobManager(): JobManager {
  if (!jobManagerInstance) {
    jobManagerInstance = new JobManager();
  }
  return jobManagerInstance;
}
