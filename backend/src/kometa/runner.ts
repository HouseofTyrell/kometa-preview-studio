import Docker from 'dockerode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';
import { ensureDir, writeText } from '../util/safeFs.js';

export interface RunnerConfig {
  kometaImage: string;
  jobsBasePath: string;      // Path inside backend container
  jobsHostPath: string;      // Path on Docker host (for child container mounts)
  fontsPath: string;         // Path inside backend container
  fontsHostPath: string;     // Path on Docker host (for child container mounts)
  cacheHostPath?: string;    // Path on Docker host for persistent Kometa cache (TMDb, etc.)
  userAssetsPath?: string;
  userKometaConfigPath?: string;
}

export interface RunnerJob {
  jobId: string;
  configYaml: string;
  rendererScript: string;  // Kept for interface compatibility, but not used with Kometa renderer
}

export type RunnerEventType = 'log' | 'progress' | 'error' | 'complete';

export interface RunnerEvent {
  type: RunnerEventType;
  timestamp: Date;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Docker runner for Kometa overlay rendering
 *
 * Uses the Kometa-based renderer image (kometa-preview-renderer) which
 * applies overlays using Kometa's actual rendering pipeline for
 * pixel-identical output.
 */
export class KometaRunner extends EventEmitter {
  private docker: Docker;
  private config: RunnerConfig;
  private runningContainers: Map<string, Docker.Container> = new Map();

  constructor(config: RunnerConfig) {
    super();
    this.docker = new Docker();
    this.config = config;
  }

  /**
   * Emit a typed event
   */
  private emitEvent(jobId: string, event: RunnerEvent): void {
    this.emit(`job:${jobId}`, event);
    this.emit('job', { jobId, ...event });
  }

  /**
   * Run the Kometa-based overlay renderer for a job
   *
   * The renderer uses Kometa's internal overlay modules to apply
   * overlays to local images without connecting to Plex.
   */
  async run(job: RunnerJob): Promise<{ exitCode: number; logs: string }> {
    const { jobId } = job;
    const jobPath = path.join(this.config.jobsBasePath, jobId);

    this.emitEvent(jobId, {
      type: 'log',
      timestamp: new Date(),
      message: `Starting Kometa-based render job: ${jobId}`,
    });

    try {
      // Ensure job directories exist
      const configDir = path.join(jobPath, 'config');
      const logsDir = path.join(jobPath, 'logs');
      const outputDir = path.join(jobPath, 'output');

      await ensureDir(configDir);
      await ensureDir(logsDir);
      await ensureDir(outputDir);

      this.emitEvent(jobId, {
        type: 'log',
        timestamp: new Date(),
        message: 'Using Kometa-based renderer for pixel-identical overlays',
      });

      // Build volume mounts using host paths for Docker daemon
      const binds = this.buildVolumeMounts(jobId);

      this.emitEvent(jobId, {
        type: 'log',
        timestamp: new Date(),
        message: `Volume mounts: ${binds.join(', ')}`,
      });

      // Pull image if needed
      await this.ensureImage();

      this.emitEvent(jobId, {
        type: 'progress',
        timestamp: new Date(),
        message: 'Creating Kometa renderer container...',
        data: { progress: 10 },
      });

      // Create container using Kometa-based renderer
      // The entrypoint in the renderer image is already set to run the preview script
      //
      // NETWORK CONFIGURATION:
      // The container needs network access because Kometa must read library metadata
      // from Plex. However, Plex WRITES are blocked by the proxy mechanism:
      //   1. The proxy runs inside the container at 127.0.0.1:32500
      //   2. kometa_run.yml sets plex.url to the proxy URL (not real Plex)
      //   3. The proxy forwards GET/HEAD to real Plex (reads allowed)
      //   4. The proxy blocks PUT/POST/PATCH/DELETE (writes blocked + captured)
      //
      // This provides read-only access to Plex with all writes safely blocked.
      const container = await this.docker.createContainer({
        Image: this.config.kometaImage,
        Cmd: ['--job', '/jobs'],  // Arguments passed to preview_entrypoint.py
        HostConfig: {
          Binds: binds,
          AutoRemove: false,
          NetworkMode: 'bridge', // Network required for Plex reads; writes blocked by proxy
        },
        Env: [
          'PYTHONUNBUFFERED=1',
          'KOMETA_DOCKER=True',  // Signal we're running in Docker context
        ],
        WorkingDir: '/',
        Tty: false,
        AttachStdout: true,
        AttachStderr: true,
      });

      this.runningContainers.set(jobId, container);

      this.emitEvent(jobId, {
        type: 'progress',
        timestamp: new Date(),
        message: 'Starting container...',
        data: { progress: 20 },
      });

      // Attach to container output
      const stream = await container.attach({
        stream: true,
        stdout: true,
        stderr: true,
      });

      const logChunks: string[] = [];

      // Handle container output
      stream.on('data', (chunk: Buffer) => {
        // Docker multiplexes stdout/stderr, first 8 bytes are header
        const data = chunk.slice(8).toString('utf-8');
        if (data.trim()) {
          logChunks.push(data);
          this.emitEvent(jobId, {
            type: 'log',
            timestamp: new Date(),
            message: data.trim(),
          });
        }
      });

      // Handle stream errors
      stream.on('error', (err) => {
        console.error(`Stream error for job ${jobId}:`, err);
        this.emitEvent(jobId, {
          type: 'log',
          timestamp: new Date(),
          message: `Stream error: ${err.message}`,
        });
      });

      // Start container
      await container.start();

      this.emitEvent(jobId, {
        type: 'progress',
        timestamp: new Date(),
        message: 'Rendering overlays...',
        data: { progress: 50 },
      });

      // Wait for container to finish
      const result = await container.wait();
      const exitCode = result.StatusCode;

      this.emitEvent(jobId, {
        type: 'progress',
        timestamp: new Date(),
        message: `Container exited with code: ${exitCode}`,
        data: { progress: 90 },
      });

      // Get full logs
      const containerLogs = await container.logs({
        stdout: true,
        stderr: true,
        follow: false,
      });

      const fullLogs = containerLogs.toString('utf-8');

      // Write logs to file
      await writeText(path.join(logsDir, 'container.log'), fullLogs);

      // Remove container
      await container.remove();
      this.runningContainers.delete(jobId);

      const eventType: RunnerEventType = exitCode === 0 ? 'complete' : 'error';
      this.emitEvent(jobId, {
        type: eventType,
        timestamp: new Date(),
        message: exitCode === 0 ? 'Render completed successfully' : `Render failed with exit code ${exitCode}`,
        data: { exitCode, progress: 100 },
      });

      return {
        exitCode,
        logs: fullLogs,
      };

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.emitEvent(jobId, {
        type: 'error',
        timestamp: new Date(),
        message: `Runner error: ${message}`,
      });
      throw err;
    }
  }

  /**
   * Build volume mount strings
   */
  private buildVolumeMounts(jobId: string): string[] {
    const binds: string[] = [];

    // Job directory (read-write)
    // Use HOST path for Docker bind mount - the Docker daemon runs on the host,
    // not inside this container, so it needs the host filesystem path
    const jobHostPath = path.join(this.config.jobsHostPath, jobId);
    binds.push(`${jobHostPath}:/jobs:rw`);

    // Fonts directory (read-only) - use host path
    binds.push(`${this.config.fontsHostPath}:/fonts:ro`);

    // User assets directory (read-only, optional)
    // These are already host paths since they're configured by the user
    if (this.config.userAssetsPath) {
      binds.push(`${this.config.userAssetsPath}:/user_assets:ro`);
    }

    // User Kometa config directory for Original Posters (read-only, optional)
    if (this.config.userKometaConfigPath) {
      binds.push(`${this.config.userKometaConfigPath}:/user_config:ro`);
    }

    // Persistent cache directory for TMDb/external API data (read-write)
    // This dramatically speeds up subsequent preview runs by caching TMDb Discover results
    // Kometa expects cache at {config_dir}/cache/, and we also mount to /kometa_cache for detection
    if (this.config.cacheHostPath) {
      // Mount to both locations:
      // 1. /kometa_cache - for the entrypoint to detect cache is enabled
      // 2. /jobs/config/cache - where Kometa actually stores the cache
      binds.push(`${this.config.cacheHostPath}:/kometa_cache:rw`);
      binds.push(`${this.config.cacheHostPath}:/jobs/config/cache:rw`);
    }

    return binds;
  }

  /**
   * Ensure the Kometa Docker image is available
   */
  private async ensureImage(): Promise<void> {
    try {
      await this.docker.getImage(this.config.kometaImage).inspect();
    } catch {
      // Image not found, pull it
      this.emitEvent('system', {
        type: 'log',
        timestamp: new Date(),
        message: `Pulling image: ${this.config.kometaImage}`,
      });

      await new Promise<void>((resolve, reject) => {
        this.docker.pull(this.config.kometaImage, (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) {
            reject(err);
            return;
          }

          this.docker.modem.followProgress(stream, (err: Error | null) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
      });
    }
  }

  /**
   * Cancel a running job
   */
  async cancel(jobId: string): Promise<boolean> {
    const container = this.runningContainers.get(jobId);
    if (!container) {
      return false;
    }

    try {
      await container.stop({ t: 5 });
      await container.remove();
      this.runningContainers.delete(jobId);

      this.emitEvent(jobId, {
        type: 'log',
        timestamp: new Date(),
        message: 'Job cancelled',
      });

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get status of a running job
   */
  async getStatus(jobId: string): Promise<'running' | 'stopped' | 'not_found'> {
    const container = this.runningContainers.get(jobId);
    if (!container) {
      return 'not_found';
    }

    try {
      const info = await container.inspect();
      return info.State.Running ? 'running' : 'stopped';
    } catch {
      return 'not_found';
    }
  }
}
