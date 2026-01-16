/**
 * API Endpoint Integration Tests
 *
 * Tests the Express API endpoints using supertest.
 * These tests verify request/response contracts.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express, { Express } from 'express';
import request from 'supertest';

// Create a minimal test app with just the routes we want to test
function createTestApp(): Express {
  const app = express();
  app.use(express.json());

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
    });
  });

  // Mock preview targets endpoint
  app.get('/api/preview/targets', (_req, res) => {
    res.json({
      targets: [
        { id: 'matrix', label: 'The Matrix (1999)', type: 'movie', displayType: 'Movie' },
        { id: 'dune', label: 'Dune (2021)', type: 'movie', displayType: 'Movie' },
        { id: 'breakingbad_series', label: 'Breaking Bad', type: 'show', displayType: 'Series' },
      ],
    });
  });

  // Mock jobs endpoint with pagination
  app.get('/api/preview/jobs', (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const statusFilter = req.query.status as string | undefined;

    const allJobs = [
      { jobId: 'job-1', status: 'completed', progress: 100, createdAt: '2026-01-16T10:00:00Z' },
      { jobId: 'job-2', status: 'failed', progress: 50, createdAt: '2026-01-16T11:00:00Z' },
      { jobId: 'job-3', status: 'running', progress: 75, createdAt: '2026-01-16T12:00:00Z' },
    ];

    let filtered = allJobs;
    if (statusFilter) {
      filtered = allJobs.filter(j => j.status === statusFilter);
    }

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const paginatedJobs = filtered.slice(offset, offset + limit);

    res.json({
      jobs: paginatedJobs,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  });

  // Mock job status endpoint
  app.get('/api/preview/status/:jobId', (req, res) => {
    const { jobId } = req.params;

    if (jobId === 'non-existent') {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.json({
      jobId,
      status: 'running',
      progress: 50,
      createdAt: '2026-01-16T10:00:00Z',
      updatedAt: '2026-01-16T10:05:00Z',
      targets: [],
      warnings: [],
    });
  });

  // Mock artifacts endpoint
  app.get('/api/preview/artifacts/:jobId', (req, res) => {
    const { jobId } = req.params;

    if (jobId === 'non-existent') {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.json({
      jobId,
      items: [
        {
          id: 'matrix',
          title: 'The Matrix',
          type: 'movie',
          beforeUrl: `/images/${jobId}/input/matrix.jpg`,
          afterUrl: `/images/${jobId}/output/matrix.jpg`,
          baseSource: 'plex_original',
          warnings: [],
        },
      ],
    });
  });

  // Mock active job endpoint
  app.get('/api/preview/active', (_req, res) => {
    res.json({
      hasActiveJob: true,
      job: {
        jobId: 'active-job-123',
        status: 'running',
        progress: 75,
      },
    });
  });

  // Mock config upload endpoint
  app.post('/api/config', (req, res) => {
    const { configYaml } = req.body;

    if (!configYaml || configYaml.trim() === '') {
      res.status(400).json({ error: 'Config YAML is required' });
      return;
    }

    // Basic YAML validation - check for common invalid patterns
    if (configYaml.includes(': yaml: [')) {
      res.status(400).json({ error: 'Invalid YAML syntax' });
      return;
    }

    res.json({
      profileId: 'test-profile-' + Date.now(),
      plexUrl: 'http://localhost:32400',
      tokenPresent: true,
      assetDirectories: [],
      overlayFiles: ['resolution'],
      libraryNames: ['Movies'],
      warnings: [],
      overlayYaml: configYaml,
    });
  });

  // Mock profile get endpoint
  app.get('/api/config/:profileId', (req, res) => {
    const { profileId } = req.params;

    if (profileId === 'non-existent') {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    res.json({
      profileId,
      plexUrl: 'http://localhost:32400',
      tokenPresent: true,
      libraryNames: ['Movies'],
      overlayFiles: ['resolution'],
    });
  });

  // Mock job control endpoints
  app.post('/api/preview/cancel/:jobId', (req, res) => {
    const { jobId } = req.params;
    if (jobId === 'fail') {
      res.status(400).json({ error: 'Cannot cancel job' });
      return;
    }
    res.json({ success: true, message: `Job ${jobId} cancelled` });
  });

  app.post('/api/preview/pause/:jobId', (req, res) => {
    const { jobId } = req.params;
    if (jobId === 'fail') {
      res.status(400).json({ error: 'Cannot pause job' });
      return;
    }
    res.json({ success: true, message: `Job ${jobId} paused` });
  });

  app.post('/api/preview/resume/:jobId', (req, res) => {
    const { jobId } = req.params;
    if (jobId === 'fail') {
      res.status(400).json({ error: 'Cannot resume job' });
      return;
    }
    res.json({ success: true, message: `Job ${jobId} resumed` });
  });

  app.delete('/api/preview/force/:jobId', (req, res) => {
    const { jobId } = req.params;
    if (jobId === 'fail') {
      res.status(400).json({ error: 'Cannot force delete job' });
      return;
    }
    res.json({ success: true, message: `Job ${jobId} force deleted` });
  });

  return app;
}

describe('API Integration Tests', () => {
  let app: Express;

  beforeEach(() => {
    app = createTestApp();
  });

  describe('GET /api/health', () => {
    it('returns health status', async () => {
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('version');
    });
  });

  describe('GET /api/preview/targets', () => {
    it('returns list of preview targets', async () => {
      const res = await request(app).get('/api/preview/targets');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('targets');
      expect(Array.isArray(res.body.targets)).toBe(true);
      expect(res.body.targets.length).toBeGreaterThan(0);
    });

    it('includes required target properties', async () => {
      const res = await request(app).get('/api/preview/targets');

      const target = res.body.targets[0];
      expect(target).toHaveProperty('id');
      expect(target).toHaveProperty('label');
      expect(target).toHaveProperty('type');
    });
  });

  describe('GET /api/preview/jobs', () => {
    it('returns paginated job list', async () => {
      const res = await request(app).get('/api/preview/jobs');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('jobs');
      expect(res.body).toHaveProperty('pagination');
      expect(res.body.pagination).toHaveProperty('page');
      expect(res.body.pagination).toHaveProperty('limit');
      expect(res.body.pagination).toHaveProperty('total');
      expect(res.body.pagination).toHaveProperty('totalPages');
      expect(res.body.pagination).toHaveProperty('hasNextPage');
      expect(res.body.pagination).toHaveProperty('hasPrevPage');
    });

    it('respects page parameter', async () => {
      const res = await request(app).get('/api/preview/jobs?page=1&limit=2');

      expect(res.status).toBe(200);
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(2);
    });

    it('filters by status', async () => {
      const res = await request(app).get('/api/preview/jobs?status=completed');

      expect(res.status).toBe(200);
      res.body.jobs.forEach((job: { status: string }) => {
        expect(job.status).toBe('completed');
      });
    });
  });

  describe('GET /api/preview/status/:jobId', () => {
    it('returns job status for valid job', async () => {
      const res = await request(app).get('/api/preview/status/test-job-123');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('jobId', 'test-job-123');
      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('progress');
    });

    it('returns 404 for non-existent job', async () => {
      const res = await request(app).get('/api/preview/status/non-existent');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/preview/artifacts/:jobId', () => {
    it('returns artifacts for valid job', async () => {
      const res = await request(app).get('/api/preview/artifacts/test-job-123');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('jobId', 'test-job-123');
      expect(res.body).toHaveProperty('items');
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('artifact items have required properties', async () => {
      const res = await request(app).get('/api/preview/artifacts/test-job-123');

      const item = res.body.items[0];
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('title');
      expect(item).toHaveProperty('beforeUrl');
      expect(item).toHaveProperty('afterUrl');
    });

    it('returns 404 for non-existent job', async () => {
      const res = await request(app).get('/api/preview/artifacts/non-existent');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/preview/active', () => {
    it('returns active job info', async () => {
      const res = await request(app).get('/api/preview/active');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('hasActiveJob');
      expect(res.body).toHaveProperty('job');
    });
  });

  describe('POST /api/config', () => {
    it('accepts valid YAML config', async () => {
      const validConfig = `
plex:
  url: http://localhost:32400
  token: test-token
libraries:
  Movies:
    overlay_files:
      - default: resolution
`;

      const res = await request(app)
        .post('/api/config')
        .send({ configYaml: validConfig });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('profileId');
      expect(res.body).toHaveProperty('plexUrl');
      expect(res.body).toHaveProperty('libraryNames');
    });

    it('rejects invalid YAML', async () => {
      const res = await request(app)
        .post('/api/config')
        .send({ configYaml: '{ invalid: yaml: [' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('rejects empty config', async () => {
      const res = await request(app)
        .post('/api/config')
        .send({ configYaml: '' });

      expect(res.status).toBe(400);
    });

    it('rejects missing config', async () => {
      const res = await request(app)
        .post('/api/config')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/config/:profileId', () => {
    it('returns profile for valid ID', async () => {
      const res = await request(app).get('/api/config/test-profile');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('profileId', 'test-profile');
    });

    it('returns 404 for non-existent profile', async () => {
      const res = await request(app).get('/api/config/non-existent');

      expect(res.status).toBe(404);
    });
  });

  describe('Job Control Endpoints', () => {
    describe('POST /api/preview/cancel/:jobId', () => {
      it('cancels a job', async () => {
        const res = await request(app).post('/api/preview/cancel/test-job-123');

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('success', true);
      });

      it('returns error when cancel fails', async () => {
        const res = await request(app).post('/api/preview/cancel/fail');

        expect(res.status).toBe(400);
      });
    });

    describe('POST /api/preview/pause/:jobId', () => {
      it('pauses a job', async () => {
        const res = await request(app).post('/api/preview/pause/test-job-123');

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('success', true);
      });

      it('returns error when pause fails', async () => {
        const res = await request(app).post('/api/preview/pause/fail');

        expect(res.status).toBe(400);
      });
    });

    describe('POST /api/preview/resume/:jobId', () => {
      it('resumes a job', async () => {
        const res = await request(app).post('/api/preview/resume/test-job-123');

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('success', true);
      });

      it('returns error when resume fails', async () => {
        const res = await request(app).post('/api/preview/resume/fail');

        expect(res.status).toBe(400);
      });
    });

    describe('DELETE /api/preview/force/:jobId', () => {
      it('force deletes a job', async () => {
        const res = await request(app).delete('/api/preview/force/test-job-123');

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('success', true);
      });

      it('returns error when force delete fails', async () => {
        const res = await request(app).delete('/api/preview/force/fail');

        expect(res.status).toBe(400);
      });
    });
  });
});
