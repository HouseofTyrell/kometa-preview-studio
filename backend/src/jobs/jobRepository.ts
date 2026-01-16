import * as fs from 'fs/promises';
import * as path from 'path';
import { getJobPaths, getJobsBasePath } from './paths.js';
import { ensureDir, pathExists, writeJson, readJson } from '../util/safeFs.js';
import { ArtworkSource } from '../plex/fetchArtwork.js';

export type JobStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

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

/**
 * Repository for job metadata persistence
 * Handles loading and saving job metadata from/to disk
 */
export class JobRepository {
  private cache: Map<string, JobMeta> = new Map();

  /**
   * Get job metadata by ID
   * Checks memory cache first, then loads from disk
   */
  async getJobMeta(jobId: string): Promise<JobMeta | null> {
    // Check memory cache first
    if (this.cache.has(jobId)) {
      return this.cache.get(jobId)!;
    }

    // Try to load from disk
    const paths = getJobPaths(jobId);
    const metaPath = path.join(paths.jobDir, 'job-meta.json');

    if (await pathExists(metaPath)) {
      try {
        const meta = await readJson(metaPath) as JobMeta;
        this.cache.set(jobId, meta);
        return meta;
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Check if a job exists in the cache
   */
  has(jobId: string): boolean {
    return this.cache.has(jobId);
  }

  /**
   * Get job from cache only (no disk lookup)
   */
  getFromCache(jobId: string): JobMeta | undefined {
    return this.cache.get(jobId);
  }

  /**
   * Set job in cache
   */
  setInCache(jobId: string, meta: JobMeta): void {
    this.cache.set(jobId, meta);
  }

  /**
   * Save job metadata to disk
   */
  async saveJobMeta(jobId: string, meta: JobMeta): Promise<void> {
    const paths = getJobPaths(jobId);
    const metaPath = path.join(paths.jobDir, 'job-meta.json');
    await ensureDir(paths.jobDir);
    await writeJson(metaPath, meta);
    this.cache.set(jobId, meta);
  }

  /**
   * Update job status
   */
  async updateStatus(
    jobId: string,
    status: JobStatus,
    progress: number,
    error?: string
  ): Promise<void> {
    const meta = this.cache.get(jobId);
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
   * List all jobs from disk
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
   * Get the currently active job (running or paused)
   */
  async getActiveJob(): Promise<JobMeta | null> {
    // Check in-memory cache first
    for (const meta of this.cache.values()) {
      if (meta.status === 'running' || meta.status === 'paused') {
        return meta;
      }
    }

    // Check persisted jobs
    const allJobs = await this.listJobs();
    for (const job of allJobs) {
      if (job.status === 'running' || job.status === 'paused') {
        return job;
      }
    }

    return null;
  }

  /**
   * Iterate over all cached jobs
   */
  values(): IterableIterator<JobMeta> {
    return this.cache.values();
  }
}
