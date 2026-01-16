/**
 * BullMQ Queue Service
 *
 * Manages job queuing and processing using BullMQ with Redis backend.
 * This provides reliable job persistence, automatic retries, and job lifecycle management.
 */

import { Queue, Worker, Job, QueueEvents, JobsOptions } from 'bullmq';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
  getRedisConfig,
  QUEUE_NAMES,
  DEFAULT_JOB_OPTIONS,
  WORKER_CONFIG,
} from './queueConfig.js';
import { JobRepository, JobMeta, JobStatus } from './jobRepository.js';
import { jobLogger } from '../util/logger.js';

/**
 * Job data payload that gets serialized to Redis
 */
export interface PreviewJobData {
  jobId: string;
  configYaml: string;
  profileId?: string;
  targetId?: string;
  selectedOverlays?: string[];
  useInstantPreview?: boolean;
  manualBuilderConfig?: {
    enabled: boolean;
  };
  createdAt: string;
}

/**
 * Job result stored after completion
 */
export interface PreviewJobResult {
  jobId: string;
  status: 'completed' | 'failed';
  exitCode?: number;
  error?: string;
  completedAt: string;
}

/**
 * Queue Service - manages BullMQ queues and workers
 */
export class QueueService extends EventEmitter {
  private queue: Queue<PreviewJobData, PreviewJobResult> | null = null;
  private worker: Worker<PreviewJobData, PreviewJobResult> | null = null;
  private queueEvents: QueueEvents | null = null;
  private repository: JobRepository;
  private jobProcessor: ((job: Job<PreviewJobData>) => Promise<PreviewJobResult>) | null = null;
  private isConnected = false;

  constructor(repository: JobRepository) {
    super();
    this.repository = repository;
  }

  /**
   * Initialize the queue service
   * Creates queue, worker, and event listeners
   */
  async initialize(
    processor: (job: Job<PreviewJobData>) => Promise<PreviewJobResult>
  ): Promise<void> {
    if (this.isConnected) {
      jobLogger.warn('Queue service already initialized');
      return;
    }

    this.jobProcessor = processor;
    const redisConfig = getRedisConfig();

    try {
      // Create the queue
      this.queue = new Queue<PreviewJobData, PreviewJobResult>(
        QUEUE_NAMES.PREVIEW_JOBS,
        {
          connection: redisConfig,
          defaultJobOptions: DEFAULT_JOB_OPTIONS,
        }
      );

      // Create queue events for monitoring
      this.queueEvents = new QueueEvents(QUEUE_NAMES.PREVIEW_JOBS, {
        connection: redisConfig,
      });

      // Create the worker
      this.worker = new Worker<PreviewJobData, PreviewJobResult>(
        QUEUE_NAMES.PREVIEW_JOBS,
        async (job) => {
          if (!this.jobProcessor) {
            throw new Error('Job processor not configured');
          }
          return this.jobProcessor(job);
        },
        {
          connection: redisConfig,
          concurrency: WORKER_CONFIG.concurrency,
          lockDuration: WORKER_CONFIG.lockDuration,
          stalledInterval: WORKER_CONFIG.stalledInterval,
        }
      );

      // Set up event handlers
      this.setupEventHandlers();

      // Wait for connections
      await this.queue.waitUntilReady();
      await this.worker.waitUntilReady();
      await this.queueEvents.waitUntilReady();

      this.isConnected = true;
      jobLogger.info('Queue service initialized successfully');
    } catch (error) {
      jobLogger.error({ err: error }, 'Failed to initialize queue service');
      throw error;
    }
  }

  /**
   * Set up event handlers for queue events
   */
  private setupEventHandlers(): void {
    if (!this.worker || !this.queueEvents) return;

    // Worker events
    this.worker.on('completed', (job, result) => {
      jobLogger.info({ jobId: job.data.jobId, result }, 'Job completed');
      this.emit('job:completed', job.data.jobId, result);
    });

    this.worker.on('failed', (job, error) => {
      if (job) {
        jobLogger.error({ jobId: job.data.jobId, error: error.message }, 'Job failed');
        this.emit('job:failed', job.data.jobId, error);
      }
    });

    this.worker.on('progress', (job, progress) => {
      this.emit('job:progress', job.data.jobId, progress);
    });

    this.worker.on('active', (job) => {
      jobLogger.info({ jobId: job.data.jobId }, 'Job started processing');
      this.emit('job:active', job.data.jobId);
    });

    this.worker.on('stalled', (jobId) => {
      jobLogger.warn({ jobId }, 'Job stalled');
      this.emit('job:stalled', jobId);
    });

    // Queue events
    this.queueEvents.on('waiting', ({ jobId }) => {
      jobLogger.debug({ jobId }, 'Job waiting in queue');
    });

    this.queueEvents.on('added', ({ jobId }) => {
      jobLogger.debug({ jobId }, 'Job added to queue');
    });
  }

  /**
   * Add a new preview job to the queue
   */
  async addJob(
    configYaml: string,
    options?: {
      profileId?: string;
      targetId?: string;
      selectedOverlays?: string[];
      useInstantPreview?: boolean;
      manualBuilderConfig?: { enabled: boolean };
    },
    jobOptions?: JobsOptions
  ): Promise<string> {
    if (!this.queue) {
      throw new Error('Queue not initialized. Call initialize() first.');
    }

    const jobId = uuidv4();
    const jobData: PreviewJobData = {
      jobId,
      configYaml,
      profileId: options?.profileId,
      targetId: options?.targetId,
      selectedOverlays: options?.selectedOverlays,
      useInstantPreview: options?.useInstantPreview,
      manualBuilderConfig: options?.manualBuilderConfig,
      createdAt: new Date().toISOString(),
    };

    // Initialize job metadata
    const jobMeta: JobMeta = {
      jobId,
      status: 'pending',
      progress: 0,
      createdAt: jobData.createdAt,
      updatedAt: jobData.createdAt,
      targets: [],
      warnings: [],
    };

    this.repository.setInCache(jobId, jobMeta);
    await this.repository.saveJobMeta(jobId, jobMeta);

    // Add to queue with job ID as the Bull job ID for easy lookup
    await this.queue.add('preview', jobData, {
      ...jobOptions,
      jobId,
    });

    jobLogger.info({ jobId }, 'Job added to queue');
    return jobId;
  }

  /**
   * Get a job by ID from the queue
   */
  async getJob(jobId: string): Promise<Job<PreviewJobData, PreviewJobResult> | undefined> {
    if (!this.queue) {
      return undefined;
    }
    return this.queue.getJob(jobId);
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    isPaused: boolean;
  }> {
    if (!this.queue) {
      return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, isPaused: false };
    }

    const [waiting, active, completed, failed, delayed, isPaused] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
      this.queue.isPaused(),
    ]);

    return { waiting, active, completed, failed, delayed, isPaused };
  }

  /**
   * Pause the queue (stops processing new jobs)
   */
  async pauseQueue(): Promise<void> {
    if (this.queue) {
      await this.queue.pause();
      jobLogger.info('Queue paused');
    }
  }

  /**
   * Resume the queue
   */
  async resumeQueue(): Promise<void> {
    if (this.queue) {
      await this.queue.resume();
      jobLogger.info('Queue resumed');
    }
  }

  /**
   * Remove a job from the queue
   */
  async removeJob(jobId: string): Promise<boolean> {
    if (!this.queue) {
      return false;
    }

    const job = await this.queue.getJob(jobId);
    if (job) {
      await job.remove();
      jobLogger.info({ jobId }, 'Job removed from queue');
      return true;
    }
    return false;
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId: string): Promise<boolean> {
    if (!this.queue) {
      return false;
    }

    const job = await this.queue.getJob(jobId);
    if (job) {
      const state = await job.getState();
      if (state === 'failed') {
        await job.retry();
        jobLogger.info({ jobId }, 'Job retry queued');
        return true;
      }
    }
    return false;
  }

  /**
   * Clean old jobs from the queue
   */
  async cleanOldJobs(gracePeriodMs: number = 24 * 60 * 60 * 1000): Promise<void> {
    if (!this.queue) {
      return;
    }

    await this.queue.clean(gracePeriodMs, 100, 'completed');
    await this.queue.clean(gracePeriodMs * 7, 50, 'failed');
    jobLogger.info('Old jobs cleaned from queue');
  }

  /**
   * Check if queue service is connected
   */
  isReady(): boolean {
    return this.isConnected;
  }

  /**
   * Gracefully shutdown the queue service
   */
  async shutdown(): Promise<void> {
    jobLogger.info('Shutting down queue service...');

    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }

    if (this.queueEvents) {
      await this.queueEvents.close();
      this.queueEvents = null;
    }

    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }

    this.isConnected = false;
    jobLogger.info('Queue service shut down');
  }
}

// Singleton instance
let queueServiceInstance: QueueService | null = null;

/**
 * Get or create the queue service singleton
 */
export function getQueueService(repository?: JobRepository): QueueService {
  if (!queueServiceInstance) {
    if (!repository) {
      throw new Error('JobRepository required for initial QueueService creation');
    }
    queueServiceInstance = new QueueService(repository);
  }
  return queueServiceInstance;
}
