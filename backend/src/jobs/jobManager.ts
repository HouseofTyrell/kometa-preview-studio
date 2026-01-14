import * as fs from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { getJobPaths, getJobsBasePath, getJobsHostPath, getFontsPath, getFontsHostPath, getKometaRendererImage, getUserPaths, getCacheHostPath } from './paths.js';
import { ensureDir, writeText, readText, pathExists, writeJson, readJson } from '../util/safeFs.js';
import { KometaRunner, RunnerConfig, RunnerEvent } from '../kometa/runner.js';
import { parseYaml, analyzeConfig, KometaConfig } from '../util/yaml.js';
import { PlexClient } from '../plex/plexClient.js';
import { resolveTargets, ResolvedTarget } from '../plex/resolveTargets.js';
import { fetchArtwork, FetchedArtwork, ArtworkSource } from '../plex/fetchArtwork.js';
import { createTmdbClient } from '../plex/tmdbClient.js';
import { generatePreviewConfig } from '../kometa/configGenerator.js';
import { TestOptions, DEFAULT_TEST_OPTIONS } from '../types/testOptions.js';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobTarget {
  id: string;
  title: string;
  type: string;
  baseSource: ArtworkSource;
  warnings: string[];
}

export interface JobMeta {
  jobId: string;
  status: JobStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  exitCode?: number;
  error?: string;
  targets: JobTarget[];
  warnings: string[];
}

export interface JobArtifacts {
  jobId: string;
  items: Array<{
    id: string;
    title: string;
    type: string;
    beforeUrl: string;
    afterUrl: string;
    baseSource: ArtworkSource;
    warnings: string[];
  }>;
}

/**
 * Job Manager - Orchestrates preview jobs
 */
class JobManager extends EventEmitter {
  private runner: KometaRunner;
  private jobs: Map<string, JobMeta> = new Map();

  constructor() {
    super();

    const runnerConfig: RunnerConfig = {
      kometaImage: getKometaRendererImage(),
      jobsBasePath: getJobsBasePath(),
      jobsHostPath: getJobsHostPath(),
      fontsPath: getFontsPath(),
      fontsHostPath: getFontsHostPath(),
      cacheHostPath: getCacheHostPath(),
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
   * Create a new preview job from config YAML
   * @param configYaml - The Kometa configuration YAML
   * @param testOptions - Optional test options for selective testing
   */
  async createJob(configYaml: string, testOptions?: TestOptions): Promise<string> {
    const jobId = uuidv4();
    const paths = getJobPaths(jobId);

    // Parse and validate config
    const parseResult = parseYaml(configYaml);
    if (parseResult.error || !parseResult.parsed) {
      throw new Error(`Invalid config: ${parseResult.error}`);
    }

    const config = parseResult.parsed as KometaConfig;
    const analysis = analyzeConfig(config);

    // Check for Plex connection
    if (!analysis.plexUrl || !analysis.tokenPresent) {
      throw new Error('Plex URL and token are required in config');
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

    this.jobs.set(jobId, jobMeta);
    await this.saveJobMeta(jobId, jobMeta);

    // Emit job creation event
    this.emit(`job:${jobId}`, {
      type: 'log',
      timestamp: new Date(),
      message: `Job created: ${jobId}`,
    });

    // Start job processing in background
    this.processJob(jobId, config, analysis, options).catch((err) => {
      console.error(`Job ${jobId} failed:`, err);
      this.updateJobStatus(jobId, 'failed', 0, err.message);
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
      this.emit(`job:${jobId}`, {
        type: 'progress',
        timestamp: new Date(),
        message: 'Connecting to Plex...',
        data: { progress: 5 },
      });

      // Create Plex client
      const plexClient = new PlexClient({
        url: analysis.plexUrl!,
        token: config.plex!.token!,
        timeout: config.plex?.timeout,
      });

      // Test connection
      await plexClient.testConnection();
      this.emit(`job:${jobId}`, {
        type: 'log',
        timestamp: new Date(),
        message: 'Plex connection successful',
      });

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

      const currentMeta = this.jobs.get(jobId)!;
      currentMeta.targets = jobTargets;
      await this.saveJobMeta(jobId, currentMeta);

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
   */
  async getJobMeta(jobId: string): Promise<JobMeta | null> {
    // Check memory cache first
    if (this.jobs.has(jobId)) {
      return this.jobs.get(jobId)!;
    }

    // Try to load from disk
    const paths = getJobPaths(jobId);
    const metaPath = path.join(paths.jobDir, 'job-meta.json');

    if (await pathExists(metaPath)) {
      try {
        const meta = await readJson(metaPath) as JobMeta;
        this.jobs.set(jobId, meta);
        return meta;
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Get job artifacts (before/after images)
   */
  async getJobArtifacts(jobId: string): Promise<JobArtifacts | null> {
    const meta = await this.getJobMeta(jobId);
    if (!meta) {
      return null;
    }

    const paths = getJobPaths(jobId);
    const items: JobArtifacts['items'] = [];

    // Supported image extensions (in priority order)
    const imageExtensions = ['png', 'jpg', 'jpeg', 'webp'];

    for (const target of meta.targets) {
      const beforeFile = `${target.id}.jpg`;
      const beforePath = path.join(paths.inputDir, beforeFile);

      // Find the after file with any supported extension
      let afterFile = '';
      let afterUrl = '';
      for (const ext of imageExtensions) {
        const candidateFile = `${target.id}_after.${ext}`;
        const candidatePath = path.join(paths.outputDir, candidateFile);
        if (await pathExists(candidatePath)) {
          afterFile = candidateFile;
          afterUrl = `/api/preview/image/${jobId}/output/${afterFile}`;
          break;
        }
      }

      if (await pathExists(beforePath)) {
        items.push({
          id: target.id,
          title: target.title,
          type: target.type,
          beforeUrl: `/api/preview/image/${jobId}/input/${beforeFile}`,
          afterUrl,
          baseSource: target.baseSource,
          warnings: target.warnings,
        });
      }
    }

    return { jobId, items };
  }

  /**
   * Get path to an image file
   */
  getImagePath(jobId: string, folder: 'input' | 'output', filename: string): string | null {
    const paths = getJobPaths(jobId);
    const dir = folder === 'input' ? paths.inputDir : paths.outputDir;

    // Sanitize filename to prevent path traversal
    const sanitized = path.basename(filename);
    if (sanitized !== filename) {
      return null;
    }

    return path.join(dir, sanitized);
  }

  /**
   * Get path to log file
   */
  getLogPath(jobId: string): string {
    const paths = getJobPaths(jobId);
    return path.join(paths.logsDir, 'container.log');
  }

  /**
   * Cancel a running job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const meta = this.jobs.get(jobId);
    if (!meta || meta.status !== 'running') {
      return false;
    }

    const cancelled = await this.runner.cancel(jobId);
    if (cancelled) {
      await this.updateJobStatus(jobId, 'cancelled', meta.progress);
    }

    return cancelled;
  }

  /**
   * List all jobs
   */
  async listJobs(): Promise<JobMeta[]> {
    const jobsBase = getJobsBasePath();
    const jobs: JobMeta[] = [];

    try {
      const entries = await fs.readdir(jobsBase, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const meta = await this.getJobMeta(entry.name);
          if (meta) {
            jobs.push(meta);
          }
        }
      }
    } catch {
      // Jobs directory might not exist yet
    }

    return jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Update job status
   */
  private async updateJobStatus(jobId: string, status: JobStatus, progress: number, error?: string): Promise<void> {
    const meta = this.jobs.get(jobId);
    if (!meta) {
      return;
    }

    meta.status = status;
    meta.progress = progress;
    meta.updatedAt = new Date().toISOString();

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      meta.completedAt = new Date().toISOString();
    }

    if (error) {
      meta.error = error;
    }

    await this.saveJobMeta(jobId, meta);
  }

  /**
   * Update job from runner event
   */
  private updateJobFromEvent(jobId: string, event: RunnerEvent): void {
    const meta = this.jobs.get(jobId);
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
    this.saveJobMeta(jobId, meta).catch(console.error);
  }

  /**
   * Save job metadata to disk
   */
  private async saveJobMeta(jobId: string, meta: JobMeta): Promise<void> {
    const paths = getJobPaths(jobId);
    const metaPath = path.join(paths.jobDir, 'job-meta.json');
    await ensureDir(paths.jobDir);
    await writeJson(metaPath, meta);
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
