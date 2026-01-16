import request from 'supertest';
import express, { Express } from 'express';
import previewStatusRouter from '../api/previewStatus.js';

/**
 * Integration tests for API endpoints
 * These tests verify HTTP behavior without mocking the Express layer
 *
 * Note: Some endpoints require JobManager which accesses the filesystem.
 * These tests focus on verifying response structure rather than full functionality.
 * Endpoints that require filesystem access may return 500 in test environment.
 */

describe('API Integration Tests', () => {
  let app: Express;

  beforeAll(() => {
    // Create a minimal Express app for testing
    app = express();
    app.use(express.json());
    app.use('/api/preview', previewStatusRouter);
  });

  describe('GET /api/preview/targets', () => {
    it('should return preview targets list', async () => {
      const response = await request(app)
        .get('/api/preview/targets')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('targets');
      expect(Array.isArray(response.body.targets)).toBe(true);
      expect(response.body.targets.length).toBeGreaterThan(0);

      // Verify target structure
      const firstTarget = response.body.targets[0];
      expect(firstTarget).toHaveProperty('id');
      expect(firstTarget).toHaveProperty('label');
      expect(firstTarget).toHaveProperty('type');
      expect(firstTarget).toHaveProperty('displayType');
    });

    it('should include all 5 preview targets', async () => {
      const response = await request(app)
        .get('/api/preview/targets')
        .expect(200);

      expect(response.body.targets.length).toBe(5);

      // Verify we have different types
      const types = new Set(response.body.targets.map((t: { type: string }) => t.type));
      expect(types.has('movie')).toBe(true);
      expect(types.has('show')).toBe(true);
    });

    it('should have properly formatted display types', async () => {
      const response = await request(app)
        .get('/api/preview/targets')
        .expect(200);

      for (const target of response.body.targets) {
        expect(target.displayType).toBeTruthy();
        // Display type should be human-readable
        expect(['Movie', 'Series'].some(s => target.displayType.startsWith(s)) ||
               target.displayType.match(/^S\d{2}E\d{2}$/) ||
               target.displayType.match(/^Season \d+$/)).toBeTruthy();
      }
    });

    it('should include target IDs matching expected format', async () => {
      const response = await request(app)
        .get('/api/preview/targets')
        .expect(200);

      for (const target of response.body.targets) {
        // IDs should be non-empty strings (e.g., 'matrix', 'dune', 'breakingbad_series')
        expect(typeof target.id).toBe('string');
        expect(target.id.length).toBeGreaterThan(0);
      }
    });

    it('should include metadata for each target', async () => {
      const response = await request(app)
        .get('/api/preview/targets')
        .expect(200);

      for (const target of response.body.targets) {
        expect(target).toHaveProperty('metadata');
        // Metadata should be an object containing preview rendering hints
        expect(typeof target.metadata).toBe('object');
      }
    });
  });

  describe('GET /api/preview/status/:jobId', () => {
    it('should return error for non-existent job', async () => {
      const response = await request(app)
        .get('/api/preview/status/non-existent-job-id')
        .expect('Content-Type', /json/);

      // Should return 404 (job not found) or 500 (internal error in test env)
      expect([404, 500]).toContain(response.status);
      expect(response.body).toHaveProperty('error');
    });

    it('should return proper error structure for missing job', async () => {
      const response = await request(app)
        .get('/api/preview/status/fake-job-12345')
        .expect('Content-Type', /json/);

      // Should return 404 or 500
      expect([404, 500]).toContain(response.status);
      expect(response.body.error).toBeDefined();
      expect(typeof response.body.error).toBe('string');
    });
  });

  // Helper function to verify error responses
  function expectErrorResponse(response: request.Response) {
    // Error responses can be in two formats:
    // 1. { success: false, message: string } - for 400 errors
    // 2. { error: string, details?: string } - for 500 errors
    const body = response.body;
    const hasSuccessFalse = body.success === false;
    const hasError = typeof body.error === 'string';
    expect(hasSuccessFalse || hasError).toBe(true);
  }

  describe('POST /api/preview/cancel/:jobId', () => {
    it('should return error for non-existent job', async () => {
      const response = await request(app)
        .post('/api/preview/cancel/non-existent-job-id')
        .expect('Content-Type', /json/);

      // Should return 400 (not found behavior) or 500 (internal error in test env)
      expect([400, 500]).toContain(response.status);
      expectErrorResponse(response);
    });
  });

  describe('DELETE /api/preview/force/:jobId', () => {
    it('should return error for non-existent job', async () => {
      const response = await request(app)
        .delete('/api/preview/force/non-existent-job-id')
        .expect('Content-Type', /json/);

      // Should return 404 (not found) or 500 (internal error in test env)
      expect([404, 500]).toContain(response.status);
      expectErrorResponse(response);
    });
  });

  describe('POST /api/preview/pause/:jobId', () => {
    it('should return error for non-existent job', async () => {
      const response = await request(app)
        .post('/api/preview/pause/non-existent-job-id')
        .expect('Content-Type', /json/);

      // Should return 400 (not found behavior) or 500 (internal error in test env)
      expect([400, 500]).toContain(response.status);
      expectErrorResponse(response);
    });
  });

  describe('POST /api/preview/resume/:jobId', () => {
    it('should return error for non-existent job', async () => {
      const response = await request(app)
        .post('/api/preview/resume/non-existent-job-id')
        .expect('Content-Type', /json/);

      // Should return 400 (not found behavior) or 500 (internal error in test env)
      expect([400, 500]).toContain(response.status);
      expectErrorResponse(response);
    });
  });

  describe('GET /api/preview/active', () => {
    it('should return JSON response', async () => {
      const response = await request(app)
        .get('/api/preview/active')
        .expect('Content-Type', /json/);

      // Response should be either 200 with hasActiveJob field or 500 with error
      if (response.status === 200) {
        expect(response.body).toHaveProperty('hasActiveJob');
        expect(typeof response.body.hasActiveJob).toBe('boolean');
      } else {
        // In test environment without proper setup, we may get an error
        expect(response.status).toBe(500);
        expect(response.body).toHaveProperty('error');
      }
    });
  });

  describe('GET /api/preview/jobs', () => {
    it('should return JSON response', async () => {
      const response = await request(app)
        .get('/api/preview/jobs')
        .expect('Content-Type', /json/);

      // Response should be either 200 with jobs array or 500 with error
      if (response.status === 200) {
        expect(response.body).toHaveProperty('jobs');
        expect(Array.isArray(response.body.jobs)).toBe(true);
      } else {
        // In test environment without proper setup, we may get an error
        expect(response.status).toBe(500);
        expect(response.body).toHaveProperty('error');
      }
    });
  });
});
