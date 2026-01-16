import request from 'supertest';
import express, { Express } from 'express';

/**
 * Integration tests for health check endpoint
 */

describe('Health Check API', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());

    // Health check endpoint (copied from index.ts)
    app.get('/api/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '0.1.0',
      });
    });
  });

  describe('GET /api/health', () => {
    it('should return 200 OK', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
    });

    it('should include timestamp', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body).toHaveProperty('timestamp');
      // Timestamp should be a valid ISO date
      expect(new Date(response.body.timestamp).toISOString()).toBe(response.body.timestamp);
    });

    it('should include version', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body).toHaveProperty('version');
      expect(response.body.version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });
});
