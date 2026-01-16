/**
 * Job Lifecycle Integration Tests
 *
 * Tests for job state transitions, repository operations,
 * and event emissions throughout the job lifecycle.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { EventEmitter } from 'events';

// Mock types for job lifecycle
type JobStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

interface JobMeta {
  jobId: string;
  status: JobStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  exitCode?: number;
  error?: string;
  targets: Array<{
    id: string;
    title: string;
    type: string;
    baseSource: string;
    warnings: string[];
  }>;
  warnings: string[];
}

/**
 * In-memory job repository for testing
 * Mimics the behavior of the real JobRepository
 */
class TestJobRepository {
  private cache: Map<string, JobMeta> = new Map();

  async getJobMeta(jobId: string): Promise<JobMeta | null> {
    return this.cache.get(jobId) || null;
  }

  has(jobId: string): boolean {
    return this.cache.has(jobId);
  }

  getFromCache(jobId: string): JobMeta | undefined {
    return this.cache.get(jobId);
  }

  setInCache(jobId: string, meta: JobMeta): void {
    this.cache.set(jobId, meta);
  }

  async saveJobMeta(jobId: string, meta: JobMeta): Promise<void> {
    this.cache.set(jobId, meta);
  }

  async updateStatus(
    jobId: string,
    status: JobStatus,
    progress: number,
    error?: string
  ): Promise<void> {
    const meta = this.cache.get(jobId);
    if (!meta) return;

    meta.status = status;
    meta.progress = progress;
    meta.updatedAt = new Date().toISOString();

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      meta.completedAt = new Date().toISOString();
    }

    if (error) {
      meta.error = error;
    }

    this.cache.set(jobId, meta);
  }

  async listJobs(): Promise<JobMeta[]> {
    return Array.from(this.cache.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getActiveJob(): Promise<JobMeta | null> {
    for (const meta of this.cache.values()) {
      if (meta.status === 'running' || meta.status === 'paused') {
        return meta;
      }
    }
    return null;
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * Job state machine for testing state transitions
 */
class JobStateMachine extends EventEmitter {
  private repository: TestJobRepository;

  // Valid state transitions
  private static readonly VALID_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
    pending: ['running', 'cancelled', 'failed'],
    running: ['completed', 'failed', 'cancelled', 'paused'],
    paused: ['running', 'cancelled', 'failed'],
    completed: [], // Terminal state
    failed: [], // Terminal state
    cancelled: [], // Terminal state
  };

  constructor(repository: TestJobRepository) {
    super();
    this.repository = repository;
  }

  async createJob(jobId: string): Promise<JobMeta> {
    const meta: JobMeta = {
      jobId,
      status: 'pending',
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      targets: [],
      warnings: [],
    };

    await this.repository.saveJobMeta(jobId, meta);
    this.emit('job:created', { jobId, status: 'pending' });
    return meta;
  }

  async transitionTo(jobId: string, newStatus: JobStatus, error?: string): Promise<boolean> {
    const meta = await this.repository.getJobMeta(jobId);
    if (!meta) {
      throw new Error(`Job ${jobId} not found`);
    }

    const currentStatus = meta.status;
    const validTransitions = JobStateMachine.VALID_TRANSITIONS[currentStatus];

    if (!validTransitions.includes(newStatus)) {
      return false;
    }

    await this.repository.updateStatus(jobId, newStatus, meta.progress, error);
    this.emit('job:transition', { jobId, from: currentStatus, to: newStatus });
    this.emit(`job:${newStatus}`, { jobId });
    return true;
  }

  async updateProgress(jobId: string, progress: number): Promise<void> {
    const meta = await this.repository.getJobMeta(jobId);
    if (!meta) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (meta.status !== 'running') {
      throw new Error(`Cannot update progress for job in ${meta.status} state`);
    }

    meta.progress = progress;
    meta.updatedAt = new Date().toISOString();
    await this.repository.saveJobMeta(jobId, meta);
    this.emit('job:progress', { jobId, progress });
  }

  isValidTransition(from: JobStatus, to: JobStatus): boolean {
    return JobStateMachine.VALID_TRANSITIONS[from].includes(to);
  }
}

describe('Job Lifecycle Integration Tests', () => {
  let repository: TestJobRepository;
  let stateMachine: JobStateMachine;

  beforeEach(() => {
    repository = new TestJobRepository();
    stateMachine = new JobStateMachine(repository);
  });

  afterEach(() => {
    repository.clear();
    stateMachine.removeAllListeners();
  });

  describe('Job Creation', () => {
    it('creates job with pending status', async () => {
      const meta = await stateMachine.createJob('test-job-1');

      expect(meta.jobId).toBe('test-job-1');
      expect(meta.status).toBe('pending');
      expect(meta.progress).toBe(0);
      expect(meta.targets).toEqual([]);
      expect(meta.warnings).toEqual([]);
    });

    it('emits job:created event', async () => {
      const eventPromise = new Promise<{ jobId: string; status: string }>((resolve) => {
        stateMachine.once('job:created', resolve);
      });

      await stateMachine.createJob('test-job-2');

      const event = await eventPromise;
      expect(event.jobId).toBe('test-job-2');
      expect(event.status).toBe('pending');
    });

    it('persists job to repository', async () => {
      await stateMachine.createJob('test-job-3');

      const stored = await repository.getJobMeta('test-job-3');
      expect(stored).not.toBeNull();
      expect(stored?.jobId).toBe('test-job-3');
    });

    it('sets timestamps on creation', async () => {
      const before = new Date().toISOString();
      const meta = await stateMachine.createJob('test-job-4');
      const after = new Date().toISOString();

      expect(meta.createdAt).toBeDefined();
      expect(meta.updatedAt).toBeDefined();
      expect(meta.createdAt >= before).toBe(true);
      expect(meta.createdAt <= after).toBe(true);
    });
  });

  describe('State Transitions', () => {
    it('transitions from pending to running', async () => {
      await stateMachine.createJob('job-1');

      const success = await stateMachine.transitionTo('job-1', 'running');
      expect(success).toBe(true);

      const meta = await repository.getJobMeta('job-1');
      expect(meta?.status).toBe('running');
    });

    it('transitions from running to completed', async () => {
      await stateMachine.createJob('job-2');
      await stateMachine.transitionTo('job-2', 'running');

      const success = await stateMachine.transitionTo('job-2', 'completed');
      expect(success).toBe(true);

      const meta = await repository.getJobMeta('job-2');
      expect(meta?.status).toBe('completed');
      expect(meta?.completedAt).toBeDefined();
    });

    it('transitions from running to failed with error', async () => {
      await stateMachine.createJob('job-3');
      await stateMachine.transitionTo('job-3', 'running');

      const success = await stateMachine.transitionTo('job-3', 'failed', 'Test error');
      expect(success).toBe(true);

      const meta = await repository.getJobMeta('job-3');
      expect(meta?.status).toBe('failed');
      expect(meta?.error).toBe('Test error');
    });

    it('transitions from running to paused', async () => {
      await stateMachine.createJob('job-4');
      await stateMachine.transitionTo('job-4', 'running');

      const success = await stateMachine.transitionTo('job-4', 'paused');
      expect(success).toBe(true);

      const meta = await repository.getJobMeta('job-4');
      expect(meta?.status).toBe('paused');
    });

    it('transitions from paused back to running', async () => {
      await stateMachine.createJob('job-5');
      await stateMachine.transitionTo('job-5', 'running');
      await stateMachine.transitionTo('job-5', 'paused');

      const success = await stateMachine.transitionTo('job-5', 'running');
      expect(success).toBe(true);

      const meta = await repository.getJobMeta('job-5');
      expect(meta?.status).toBe('running');
    });

    it('transitions to cancelled from running', async () => {
      await stateMachine.createJob('job-6');
      await stateMachine.transitionTo('job-6', 'running');

      const success = await stateMachine.transitionTo('job-6', 'cancelled');
      expect(success).toBe(true);

      const meta = await repository.getJobMeta('job-6');
      expect(meta?.status).toBe('cancelled');
      expect(meta?.completedAt).toBeDefined();
    });
  });

  describe('Invalid State Transitions', () => {
    it('rejects transition from pending to completed', async () => {
      await stateMachine.createJob('job-invalid-1');

      const success = await stateMachine.transitionTo('job-invalid-1', 'completed');
      expect(success).toBe(false);

      const meta = await repository.getJobMeta('job-invalid-1');
      expect(meta?.status).toBe('pending');
    });

    it('rejects transition from completed to running', async () => {
      await stateMachine.createJob('job-invalid-2');
      await stateMachine.transitionTo('job-invalid-2', 'running');
      await stateMachine.transitionTo('job-invalid-2', 'completed');

      const success = await stateMachine.transitionTo('job-invalid-2', 'running');
      expect(success).toBe(false);

      const meta = await repository.getJobMeta('job-invalid-2');
      expect(meta?.status).toBe('completed');
    });

    it('rejects transition from failed to any state', async () => {
      await stateMachine.createJob('job-invalid-3');
      await stateMachine.transitionTo('job-invalid-3', 'running');
      await stateMachine.transitionTo('job-invalid-3', 'failed', 'Error');

      expect(await stateMachine.transitionTo('job-invalid-3', 'running')).toBe(false);
      expect(await stateMachine.transitionTo('job-invalid-3', 'completed')).toBe(false);
      expect(await stateMachine.transitionTo('job-invalid-3', 'paused')).toBe(false);
    });

    it('rejects transition from cancelled to any state', async () => {
      await stateMachine.createJob('job-invalid-4');
      await stateMachine.transitionTo('job-invalid-4', 'cancelled');

      expect(await stateMachine.transitionTo('job-invalid-4', 'running')).toBe(false);
      expect(await stateMachine.transitionTo('job-invalid-4', 'completed')).toBe(false);
    });

    it('rejects transition from pending to paused', async () => {
      await stateMachine.createJob('job-invalid-5');

      const success = await stateMachine.transitionTo('job-invalid-5', 'paused');
      expect(success).toBe(false);
    });
  });

  describe('Progress Updates', () => {
    it('updates progress for running job', async () => {
      await stateMachine.createJob('progress-job-1');
      await stateMachine.transitionTo('progress-job-1', 'running');

      await stateMachine.updateProgress('progress-job-1', 50);

      const meta = await repository.getJobMeta('progress-job-1');
      expect(meta?.progress).toBe(50);
    });

    it('emits progress event', async () => {
      await stateMachine.createJob('progress-job-2');
      await stateMachine.transitionTo('progress-job-2', 'running');

      const eventPromise = new Promise<{ jobId: string; progress: number }>((resolve) => {
        stateMachine.once('job:progress', resolve);
      });

      await stateMachine.updateProgress('progress-job-2', 75);

      const event = await eventPromise;
      expect(event.jobId).toBe('progress-job-2');
      expect(event.progress).toBe(75);
    });

    it('rejects progress update for non-running job', async () => {
      await stateMachine.createJob('progress-job-3');

      await expect(stateMachine.updateProgress('progress-job-3', 50)).rejects.toThrow(
        'Cannot update progress for job in pending state'
      );
    });

    it('rejects progress update for completed job', async () => {
      await stateMachine.createJob('progress-job-4');
      await stateMachine.transitionTo('progress-job-4', 'running');
      await stateMachine.transitionTo('progress-job-4', 'completed');

      await expect(stateMachine.updateProgress('progress-job-4', 100)).rejects.toThrow(
        'Cannot update progress for job in completed state'
      );
    });

    it('updates timestamp on progress change', async () => {
      await stateMachine.createJob('progress-job-5');
      await stateMachine.transitionTo('progress-job-5', 'running');

      const before = await repository.getJobMeta('progress-job-5');
      const originalUpdated = before?.updatedAt;

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));
      await stateMachine.updateProgress('progress-job-5', 25);

      const after = await repository.getJobMeta('progress-job-5');
      expect(after?.updatedAt).not.toBe(originalUpdated);
    });
  });

  describe('Event Emissions', () => {
    it('emits transition event with from/to states', async () => {
      await stateMachine.createJob('event-job-1');

      const eventPromise = new Promise<{ jobId: string; from: string; to: string }>((resolve) => {
        stateMachine.once('job:transition', resolve);
      });

      await stateMachine.transitionTo('event-job-1', 'running');

      const event = await eventPromise;
      expect(event.from).toBe('pending');
      expect(event.to).toBe('running');
    });

    it('emits state-specific events', async () => {
      await stateMachine.createJob('event-job-2');

      const completedPromise = new Promise<{ jobId: string }>((resolve) => {
        stateMachine.once('job:completed', resolve);
      });

      await stateMachine.transitionTo('event-job-2', 'running');
      await stateMachine.transitionTo('event-job-2', 'completed');

      const event = await completedPromise;
      expect(event.jobId).toBe('event-job-2');
    });

    it('emits multiple events for complete lifecycle', async () => {
      await stateMachine.createJob('event-job-3');

      const events: string[] = [];
      stateMachine.on('job:transition', (e: { to: string }) => events.push(`transition:${e.to}`));
      stateMachine.on('job:running', () => events.push('running'));
      stateMachine.on('job:completed', () => events.push('completed'));

      await stateMachine.transitionTo('event-job-3', 'running');
      await stateMachine.transitionTo('event-job-3', 'completed');

      expect(events).toContain('transition:running');
      expect(events).toContain('transition:completed');
      expect(events).toContain('running');
      expect(events).toContain('completed');
    });
  });

  describe('Repository Operations', () => {
    it('lists all jobs sorted by creation time', async () => {
      await stateMachine.createJob('list-job-1');
      await new Promise((r) => setTimeout(r, 10));
      await stateMachine.createJob('list-job-2');
      await new Promise((r) => setTimeout(r, 10));
      await stateMachine.createJob('list-job-3');

      const jobs = await repository.listJobs();

      expect(jobs.length).toBe(3);
      expect(jobs[0].jobId).toBe('list-job-3'); // Most recent first
      expect(jobs[2].jobId).toBe('list-job-1'); // Oldest last
    });

    it('finds active job', async () => {
      await stateMachine.createJob('active-job-1');
      await stateMachine.createJob('active-job-2');
      await stateMachine.transitionTo('active-job-2', 'running');

      const activeJob = await repository.getActiveJob();

      expect(activeJob).not.toBeNull();
      expect(activeJob?.jobId).toBe('active-job-2');
      expect(activeJob?.status).toBe('running');
    });

    it('returns null when no active job', async () => {
      await stateMachine.createJob('completed-job-1');
      await stateMachine.transitionTo('completed-job-1', 'running');
      await stateMachine.transitionTo('completed-job-1', 'completed');

      const activeJob = await repository.getActiveJob();

      expect(activeJob).toBeNull();
    });

    it('finds paused job as active', async () => {
      await stateMachine.createJob('paused-active-1');
      await stateMachine.transitionTo('paused-active-1', 'running');
      await stateMachine.transitionTo('paused-active-1', 'paused');

      const activeJob = await repository.getActiveJob();

      expect(activeJob).not.toBeNull();
      expect(activeJob?.status).toBe('paused');
    });
  });

  describe('Valid Transition Verification', () => {
    const testCases: Array<{ from: JobStatus; to: JobStatus; expected: boolean }> = [
      // From pending
      { from: 'pending', to: 'running', expected: true },
      { from: 'pending', to: 'cancelled', expected: true },
      { from: 'pending', to: 'failed', expected: true },
      { from: 'pending', to: 'completed', expected: false },
      { from: 'pending', to: 'paused', expected: false },

      // From running
      { from: 'running', to: 'completed', expected: true },
      { from: 'running', to: 'failed', expected: true },
      { from: 'running', to: 'cancelled', expected: true },
      { from: 'running', to: 'paused', expected: true },
      { from: 'running', to: 'pending', expected: false },

      // From paused
      { from: 'paused', to: 'running', expected: true },
      { from: 'paused', to: 'cancelled', expected: true },
      { from: 'paused', to: 'failed', expected: true },
      { from: 'paused', to: 'completed', expected: false },
      { from: 'paused', to: 'pending', expected: false },

      // From terminal states
      { from: 'completed', to: 'running', expected: false },
      { from: 'failed', to: 'running', expected: false },
      { from: 'cancelled', to: 'running', expected: false },
    ];

    testCases.forEach(({ from, to, expected }) => {
      it(`validates ${from} -> ${to} is ${expected ? 'valid' : 'invalid'}`, () => {
        expect(stateMachine.isValidTransition(from, to)).toBe(expected);
      });
    });
  });

  describe('Error Handling', () => {
    it('throws error for non-existent job transition', async () => {
      await expect(stateMachine.transitionTo('non-existent', 'running')).rejects.toThrow(
        'Job non-existent not found'
      );
    });

    it('throws error for non-existent job progress update', async () => {
      await expect(stateMachine.updateProgress('non-existent', 50)).rejects.toThrow(
        'Job non-existent not found'
      );
    });

    it('preserves error message on failed transition', async () => {
      await stateMachine.createJob('error-job-1');
      await stateMachine.transitionTo('error-job-1', 'running');
      await stateMachine.transitionTo('error-job-1', 'failed', 'Container exit code 1');

      const meta = await repository.getJobMeta('error-job-1');
      expect(meta?.error).toBe('Container exit code 1');
      expect(meta?.status).toBe('failed');
    });
  });

  describe('Complete Lifecycle Scenarios', () => {
    it('handles successful job completion', async () => {
      // Create job
      const meta = await stateMachine.createJob('success-scenario');
      expect(meta.status).toBe('pending');

      // Start running
      await stateMachine.transitionTo('success-scenario', 'running');
      let current = await repository.getJobMeta('success-scenario');
      expect(current?.status).toBe('running');

      // Progress updates
      await stateMachine.updateProgress('success-scenario', 25);
      await stateMachine.updateProgress('success-scenario', 50);
      await stateMachine.updateProgress('success-scenario', 75);
      await stateMachine.updateProgress('success-scenario', 100);

      current = await repository.getJobMeta('success-scenario');
      expect(current?.progress).toBe(100);

      // Complete
      await stateMachine.transitionTo('success-scenario', 'completed');
      current = await repository.getJobMeta('success-scenario');
      expect(current?.status).toBe('completed');
      expect(current?.completedAt).toBeDefined();
    });

    it('handles job with pause and resume', async () => {
      await stateMachine.createJob('pause-resume-scenario');
      await stateMachine.transitionTo('pause-resume-scenario', 'running');
      await stateMachine.updateProgress('pause-resume-scenario', 30);

      // Pause
      await stateMachine.transitionTo('pause-resume-scenario', 'paused');
      let current = await repository.getJobMeta('pause-resume-scenario');
      expect(current?.status).toBe('paused');
      expect(current?.progress).toBe(30);

      // Resume
      await stateMachine.transitionTo('pause-resume-scenario', 'running');
      current = await repository.getJobMeta('pause-resume-scenario');
      expect(current?.status).toBe('running');

      // Continue and complete
      await stateMachine.updateProgress('pause-resume-scenario', 100);
      await stateMachine.transitionTo('pause-resume-scenario', 'completed');

      current = await repository.getJobMeta('pause-resume-scenario');
      expect(current?.status).toBe('completed');
    });

    it('handles job cancellation mid-progress', async () => {
      await stateMachine.createJob('cancel-scenario');
      await stateMachine.transitionTo('cancel-scenario', 'running');
      await stateMachine.updateProgress('cancel-scenario', 45);

      // Cancel
      await stateMachine.transitionTo('cancel-scenario', 'cancelled');

      const current = await repository.getJobMeta('cancel-scenario');
      expect(current?.status).toBe('cancelled');
      expect(current?.progress).toBe(45);
      expect(current?.completedAt).toBeDefined();
    });

    it('handles job failure with error details', async () => {
      await stateMachine.createJob('failure-scenario');
      await stateMachine.transitionTo('failure-scenario', 'running');
      await stateMachine.updateProgress('failure-scenario', 60);

      // Fail
      await stateMachine.transitionTo(
        'failure-scenario',
        'failed',
        'Renderer exited with code 137 (out of memory)'
      );

      const current = await repository.getJobMeta('failure-scenario');
      expect(current?.status).toBe('failed');
      expect(current?.error).toContain('out of memory');
      expect(current?.completedAt).toBeDefined();
    });
  });
});
