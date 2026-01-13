import Docker from 'dockerode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';
import { ensureDir, writeText } from '../util/safeFs.js';

export interface RunnerConfig {
  kometaImage: string;
  jobsBasePath: string;
  fontsPath: string;
  userAssetsPath?: string;
  userKometaConfigPath?: string;
}

export interface RunnerJob {
  jobId: string;
  configYaml: string;
  rendererScript: string;
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
   * Run the overlay renderer for a job
   */
  async run(job: RunnerJob): Promise<{ exitCode: number; logs: string }> {
    const { jobId, rendererScript } = job;
    const jobPath = path.join(this.config.jobsBasePath, jobId);

    this.emitEvent(jobId, {
      type: 'log',
      timestamp: new Date(),
      message: `Starting render job: ${jobId}`,
    });

    try {
      // Ensure job directories exist
      const configDir = path.join(jobPath, 'config');
      const logsDir = path.join(jobPath, 'logs');
      const outputDir = path.join(jobPath, 'output');

      await ensureDir(configDir);
      await ensureDir(logsDir);
      await ensureDir(outputDir);

      // Write the renderer script
      const scriptPath = path.join(configDir, 'renderer.py');
      await writeText(scriptPath, rendererScript);
      await fs.chmod(scriptPath, 0o755);

      this.emitEvent(jobId, {
        type: 'log',
        timestamp: new Date(),
        message: 'Renderer script written',
      });

      // Build volume mounts
      const binds = this.buildVolumeMounts(jobPath);

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
        message: 'Creating container...',
        data: { progress: 10 },
      });

      // Create container
      const container = await this.docker.createContainer({
        Image: this.config.kometaImage,
        Cmd: ['python3', '/jobs/config/renderer.py'],
        HostConfig: {
          Binds: binds,
          AutoRemove: false,
          NetworkMode: 'none', // No network access for safety
        },
        Env: [
          'PYTHONUNBUFFERED=1',
        ],
        WorkingDir: '/jobs',
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
  private buildVolumeMounts(jobPath: string): string[] {
    const binds: string[] = [];

    // Job directory (read-write)
    binds.push(`${jobPath}:/jobs:rw`);

    // Fonts directory (read-only)
    binds.push(`${this.config.fontsPath}:/fonts:ro`);

    // User assets directory (read-only, optional)
    if (this.config.userAssetsPath) {
      binds.push(`${this.config.userAssetsPath}:/user_assets:ro`);
    }

    // User Kometa config directory for Original Posters (read-only, optional)
    if (this.config.userKometaConfigPath) {
      binds.push(`${this.config.userKometaConfigPath}:/user_config:ro`);
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
