/**
 * SSE Event Streaming Integration Tests
 *
 * Tests for Server-Sent Events (SSE) functionality including:
 * - Event formatting
 * - Connection lifecycle with proper termination
 * - Helper functions
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import express, { Express, Response } from 'express';
import request from 'supertest';
import { EventEmitter } from 'events';

// Constants matching production values
const SSE_CLOSE_DELAY_MS = 100; // Shorter for tests

interface JobEvent {
  type: string;
  timestamp: Date;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Mock job manager that emits events
 */
class MockJobManager extends EventEmitter {
  private jobs = new Map<string, { status: string; progress: number }>();

  createJob(jobId: string): void {
    this.jobs.set(jobId, { status: 'pending', progress: 0 });
    this.emit(`job:${jobId}`, {
      type: 'log',
      timestamp: new Date(),
      message: `Job created: ${jobId}`,
    });
  }

  startJob(jobId: string): void {
    this.jobs.set(jobId, { status: 'running', progress: 0 });
    this.emit(`job:${jobId}`, {
      type: 'progress',
      timestamp: new Date(),
      message: 'Job started',
      data: { progress: 0 },
    });
  }

  updateProgress(jobId: string, progress: number): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.progress = progress;
      this.emit(`job:${jobId}`, {
        type: 'progress',
        timestamp: new Date(),
        message: `Progress: ${progress}%`,
        data: { progress },
      });
    }
  }

  completeJob(jobId: string): void {
    this.jobs.set(jobId, { status: 'completed', progress: 100 });
    this.emit(`job:${jobId}`, {
      type: 'complete',
      timestamp: new Date(),
      message: 'Job completed successfully',
      data: { progress: 100, exitCode: 0 },
    });
  }

  failJob(jobId: string, error: string): void {
    this.jobs.set(jobId, { status: 'failed', progress: 0 });
    this.emit(`job:${jobId}`, {
      type: 'error',
      timestamp: new Date(),
      message: `Job failed: ${error}`,
      data: { error },
    });
  }
}

/**
 * Safely write to SSE response
 */
function safeSSEWrite(res: Response, data: string): boolean {
  if (res.writableEnded || res.destroyed) {
    return false;
  }
  try {
    res.write(data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format SSE event data
 */
function formatSSEEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Create test app with SSE endpoint
 */
function createTestApp(jobManager: MockJobManager): Express {
  const app = express();

  app.get('/api/preview/events/:jobId', (req, res) => {
    const { jobId } = req.params;

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send initial connection event
    safeSSEWrite(res, formatSSEEvent('connected', { jobId }));

    // Listen for job events
    const eventHandler = (event: JobEvent) => {
      const eventData = {
        type: event.type,
        timestamp: event.timestamp.toISOString(),
        message: event.message,
        ...event.data,
      };

      safeSSEWrite(res, formatSSEEvent(event.type, eventData));

      // Close connection on complete or error
      if (event.type === 'complete' || event.type === 'error') {
        setTimeout(() => {
          if (safeSSEWrite(res, formatSSEEvent('close', {}))) {
            res.end();
          }
        }, SSE_CLOSE_DELAY_MS);
      }
    };

    jobManager.on(`job:${jobId}`, eventHandler);

    // Handle client disconnect
    req.on('close', () => {
      jobManager.off(`job:${jobId}`, eventHandler);
    });
  });

  return app;
}

/**
 * Parse SSE response text into events
 */
function parseSSEEvents(text: string): Array<{ event: string; data: unknown }> {
  const events: Array<{ event: string; data: unknown }> = [];
  const lines = text.split('\n');

  let currentEvent = '';
  let currentData = '';

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7);
    } else if (line.startsWith('data: ')) {
      currentData = line.slice(6);
    } else if (line === '' && currentEvent && currentData) {
      try {
        events.push({ event: currentEvent, data: JSON.parse(currentData) });
      } catch {
        events.push({ event: currentEvent, data: currentData });
      }
      currentEvent = '';
      currentData = '';
    }
  }

  return events;
}

describe('SSE Event Streaming Integration Tests', () => {
  let jobManager: MockJobManager;
  let app: Express;

  beforeEach(() => {
    jobManager = new MockJobManager();
    app = createTestApp(jobManager);
  });

  afterEach(() => {
    jobManager.removeAllListeners();
  });

  describe('SSE Event Formatting', () => {
    it('formats event with correct SSE syntax', () => {
      const formatted = formatSSEEvent('progress', { progress: 50 });
      expect(formatted).toBe('event: progress\ndata: {"progress":50}\n\n');
    });

    it('handles complex data in events', () => {
      const data = {
        type: 'log',
        timestamp: '2026-01-16T12:00:00.000Z',
        message: 'Processing item',
        details: { items: ['a', 'b'], count: 2 },
      };
      const formatted = formatSSEEvent('log', data);
      expect(formatted).toMatch(/^event: log\ndata: /);
      expect(JSON.parse(formatted.split('\ndata: ')[1].replace('\n\n', ''))).toEqual(data);
    });

    it('escapes special characters in data', () => {
      const data = { message: 'Line 1\nLine 2\tTabbed' };
      const formatted = formatSSEEvent('log', data);
      // JSON.stringify handles escaping
      expect(formatted).toContain('\\n');
      expect(formatted).toContain('\\t');
    });
  });

  describe('safeSSEWrite Helper', () => {
    it('returns true when writing successfully', () => {
      const mockRes = {
        writableEnded: false,
        destroyed: false,
        write: jest.fn().mockReturnValue(true),
      } as unknown as Response;

      const result = safeSSEWrite(mockRes, 'test data');

      expect(result).toBe(true);
      expect(mockRes.write).toHaveBeenCalledWith('test data');
    });

    it('returns false when response is ended', () => {
      const mockRes = {
        writableEnded: true,
        destroyed: false,
        write: jest.fn(),
      } as unknown as Response;

      const result = safeSSEWrite(mockRes, 'test data');

      expect(result).toBe(false);
      expect(mockRes.write).not.toHaveBeenCalled();
    });

    it('returns false when response is destroyed', () => {
      const mockRes = {
        writableEnded: false,
        destroyed: true,
        write: jest.fn(),
      } as unknown as Response;

      const result = safeSSEWrite(mockRes, 'test data');

      expect(result).toBe(false);
      expect(mockRes.write).not.toHaveBeenCalled();
    });

    it('returns false when write throws', () => {
      const mockRes = {
        writableEnded: false,
        destroyed: false,
        write: jest.fn().mockImplementation(() => {
          throw new Error('Write error');
        }),
      } as unknown as Response;

      const result = safeSSEWrite(mockRes, 'test data');

      expect(result).toBe(false);
    });
  });

  describe('SSE Parser', () => {
    it('parses single event', () => {
      const text = 'event: connected\ndata: {"jobId":"test-123"}\n\n';
      const events = parseSSEEvents(text);

      expect(events.length).toBe(1);
      expect(events[0].event).toBe('connected');
      expect(events[0].data).toEqual({ jobId: 'test-123' });
    });

    it('parses multiple events', () => {
      const text = [
        'event: connected\ndata: {"jobId":"test"}\n\n',
        'event: progress\ndata: {"progress":50}\n\n',
        'event: complete\ndata: {"exitCode":0}\n\n',
      ].join('');

      const events = parseSSEEvents(text);

      expect(events.length).toBe(3);
      expect(events.map(e => e.event)).toEqual(['connected', 'progress', 'complete']);
    });

    it('handles events with complex data', () => {
      const data = { nested: { array: [1, 2, 3] }, string: 'test' };
      const text = `event: test\ndata: ${JSON.stringify(data)}\n\n`;
      const events = parseSSEEvents(text);

      expect(events[0].data).toEqual(data);
    });

    it('ignores comment lines', () => {
      const text = ': heartbeat\nevent: test\ndata: {}\n\n';
      const events = parseSSEEvents(text);

      expect(events.length).toBe(1);
      expect(events[0].event).toBe('test');
    });
  });

  describe('Connection Lifecycle with Complete Event', () => {
    it('sends close event after complete', (done) => {
      const jobId = 'complete-lifecycle-job';
      let responseData = '';

      const req = request(app)
        .get(`/api/preview/events/${jobId}`)
        .buffer(false);

      req.parse((res, callback) => {
        res.on('data', (chunk: Buffer) => {
          responseData += chunk.toString();
        });
        res.on('end', () => callback(null, responseData));
      });

      req.then(() => {
        const events = parseSSEEvents(responseData);
        const eventTypes = events.map(e => e.event);

        expect(eventTypes).toContain('connected');
        expect(eventTypes).toContain('complete');
        expect(eventTypes).toContain('close');
        done();
      }).catch(done);

      // Trigger complete which will close the connection
      setTimeout(() => {
        jobManager.completeJob(jobId);
      }, 50);
    });

    it('sends close event after error', (done) => {
      const jobId = 'error-lifecycle-job';
      let responseData = '';

      const req = request(app)
        .get(`/api/preview/events/${jobId}`)
        .buffer(false);

      req.parse((res, callback) => {
        res.on('data', (chunk: Buffer) => {
          responseData += chunk.toString();
        });
        res.on('end', () => callback(null, responseData));
      });

      req.then(() => {
        const events = parseSSEEvents(responseData);
        const eventTypes = events.map(e => e.event);

        expect(eventTypes).toContain('connected');
        expect(eventTypes).toContain('error');
        expect(eventTypes).toContain('close');
        done();
      }).catch(done);

      setTimeout(() => {
        jobManager.failJob(jobId, 'Test error');
      }, 50);
    });
  });

  describe('Full Job Lifecycle Events', () => {
    it('streams all events in correct order', (done) => {
      const jobId = 'full-lifecycle-job';
      let responseData = '';

      const req = request(app)
        .get(`/api/preview/events/${jobId}`)
        .buffer(false);

      req.parse((res, callback) => {
        res.on('data', (chunk: Buffer) => {
          responseData += chunk.toString();
        });
        res.on('end', () => callback(null, responseData));
      });

      req.then(() => {
        const events = parseSSEEvents(responseData);
        const eventTypes = events.map(e => e.event);

        // Verify event order
        expect(eventTypes[0]).toBe('connected');
        expect(eventTypes).toContain('log');
        expect(eventTypes).toContain('progress');
        expect(eventTypes).toContain('complete');
        expect(eventTypes[eventTypes.length - 1]).toBe('close');
        done();
      }).catch(done);

      // Simulate job lifecycle
      setTimeout(() => {
        jobManager.createJob(jobId);
        jobManager.startJob(jobId);
        jobManager.updateProgress(jobId, 50);
        jobManager.completeJob(jobId);
      }, 50);
    });

    it('includes correct data in progress events', (done) => {
      const jobId = 'progress-data-job';
      let responseData = '';

      const req = request(app)
        .get(`/api/preview/events/${jobId}`)
        .buffer(false);

      req.parse((res, callback) => {
        res.on('data', (chunk: Buffer) => {
          responseData += chunk.toString();
        });
        res.on('end', () => callback(null, responseData));
      });

      req.then(() => {
        const events = parseSSEEvents(responseData);
        const progressEvents = events.filter(e => e.event === 'progress');

        expect(progressEvents.length).toBeGreaterThan(0);

        // Check progress values are present
        const progressValues = progressEvents.map(
          e => (e.data as { progress: number }).progress
        );
        expect(progressValues).toContain(25);
        expect(progressValues).toContain(75);
        done();
      }).catch(done);

      setTimeout(() => {
        jobManager.startJob(jobId);
        jobManager.updateProgress(jobId, 25);
        jobManager.updateProgress(jobId, 75);
        jobManager.completeJob(jobId);
      }, 50);
    });

    it('includes timestamp in all events', (done) => {
      const jobId = 'timestamp-check-job';
      let responseData = '';

      const req = request(app)
        .get(`/api/preview/events/${jobId}`)
        .buffer(false);

      req.parse((res, callback) => {
        res.on('data', (chunk: Buffer) => {
          responseData += chunk.toString();
        });
        res.on('end', () => callback(null, responseData));
      });

      req.then(() => {
        const events = parseSSEEvents(responseData);

        // All events except 'connected' and 'close' should have timestamps
        const eventsWithTimestamp = events.filter(
          e => e.event !== 'connected' && e.event !== 'close'
        );

        for (const event of eventsWithTimestamp) {
          const data = event.data as { timestamp?: string };
          expect(data.timestamp).toBeDefined();
          expect(data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        }
        done();
      }).catch(done);

      setTimeout(() => {
        jobManager.createJob(jobId);
        jobManager.completeJob(jobId);
      }, 50);
    });
  });

  describe('Error Event Details', () => {
    it('includes error message in error event', (done) => {
      const jobId = 'error-details-job';
      const errorMessage = 'Container exited with code 137';
      let responseData = '';

      const req = request(app)
        .get(`/api/preview/events/${jobId}`)
        .buffer(false);

      req.parse((res, callback) => {
        res.on('data', (chunk: Buffer) => {
          responseData += chunk.toString();
        });
        res.on('end', () => callback(null, responseData));
      });

      req.then(() => {
        const events = parseSSEEvents(responseData);
        const errorEvent = events.find(e => e.event === 'error');

        expect(errorEvent).toBeDefined();
        const data = errorEvent?.data as { error: string; message: string };
        expect(data.error).toBe(errorMessage);
        expect(data.message).toContain(errorMessage);
        done();
      }).catch(done);

      setTimeout(() => {
        jobManager.failJob(jobId, errorMessage);
      }, 50);
    });
  });

  describe('Complete Event Details', () => {
    it('includes exit code in complete event', (done) => {
      const jobId = 'complete-details-job';
      let responseData = '';

      const req = request(app)
        .get(`/api/preview/events/${jobId}`)
        .buffer(false);

      req.parse((res, callback) => {
        res.on('data', (chunk: Buffer) => {
          responseData += chunk.toString();
        });
        res.on('end', () => callback(null, responseData));
      });

      req.then(() => {
        const events = parseSSEEvents(responseData);
        const completeEvent = events.find(e => e.event === 'complete');

        expect(completeEvent).toBeDefined();
        const data = completeEvent?.data as { progress: number; exitCode: number };
        expect(data.progress).toBe(100);
        expect(data.exitCode).toBe(0);
        done();
      }).catch(done);

      setTimeout(() => {
        jobManager.completeJob(jobId);
      }, 50);
    });
  });

  describe('Event Handler Registration', () => {
    it('registers event handler on connection', (done) => {
      const jobId = 'handler-registration-job';
      expect(jobManager.listenerCount(`job:${jobId}`)).toBe(0);

      const req = request(app)
        .get(`/api/preview/events/${jobId}`)
        .buffer(false)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on('end', () => callback(null, data));
        });

      // Give time for connection to establish
      setTimeout(() => {
        expect(jobManager.listenerCount(`job:${jobId}`)).toBe(1);
        // Complete the job to close connection
        jobManager.completeJob(jobId);
      }, 100);

      req.then(() => done()).catch(done);
    });

    it('removes event handler when connection closes', (done) => {
      const jobId = 'handler-cleanup-job';

      const req = request(app)
        .get(`/api/preview/events/${jobId}`)
        .buffer(false)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on('end', () => callback(null, data));
        });

      setTimeout(() => {
        // Complete job to trigger close
        jobManager.completeJob(jobId);
      }, 50);

      req.then(() => {
        // After response ends, listener should be cleaned up
        // Note: The cleanup happens in the 'close' event handler
        setTimeout(() => {
          expect(jobManager.listenerCount(`job:${jobId}`)).toBe(0);
          done();
        }, 50);
      }).catch(done);
    });
  });

  describe('Multiple Concurrent Connections', () => {
    it('isolates events between different jobs', (done) => {
      let responseData1 = '';
      let responseData2 = '';

      const req1 = request(app)
        .get('/api/preview/events/job-1')
        .buffer(false);

      req1.parse((res, callback) => {
        res.on('data', (chunk: Buffer) => {
          responseData1 += chunk.toString();
        });
        res.on('end', () => callback(null, responseData1));
      });

      const req2 = request(app)
        .get('/api/preview/events/job-2')
        .buffer(false);

      req2.parse((res, callback) => {
        res.on('data', (chunk: Buffer) => {
          responseData2 += chunk.toString();
        });
        res.on('end', () => callback(null, responseData2));
      });

      setTimeout(() => {
        // Start jobs first so they exist in the map
        jobManager.startJob('job-1');
        jobManager.startJob('job-2');

        // Update job-1 with specific progress
        jobManager.updateProgress('job-1', 33);
        // Update job-2 with different progress
        jobManager.updateProgress('job-2', 66);

        // Complete both to close connections
        jobManager.completeJob('job-1');
        jobManager.completeJob('job-2');
      }, 50);

      Promise.all([req1, req2]).then(() => {
        const events1 = parseSSEEvents(responseData1);
        const events2 = parseSSEEvents(responseData2);

        // Get all progress events and find the one with our specific progress value
        const progressEvents1 = events1.filter(e => e.event === 'progress');
        const progressEvents2 = events2.filter(e => e.event === 'progress');

        // Each job should have received its own progress values (0 from start, then 33/66)
        const progressValues1 = progressEvents1.map(e => (e.data as { progress: number }).progress);
        const progressValues2 = progressEvents2.map(e => (e.data as { progress: number }).progress);

        expect(progressValues1).toContain(33);
        expect(progressValues2).toContain(66);
        // Ensure events are isolated - job-1 shouldn't have 66 and job-2 shouldn't have 33
        expect(progressValues1).not.toContain(66);
        expect(progressValues2).not.toContain(33);
        done();
      }).catch(done);
    });
  });
});
