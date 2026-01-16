import express from 'express';
import cors from 'cors';
import multer from 'multer';
import * as path from 'path';
import configRouter from './api/configUpload.js';
import plexRouter from './api/plexApi.js';
import previewStartRouter from './api/previewStart.js';
import previewStatusRouter from './api/previewStatus.js';
import previewArtifactsRouter from './api/previewArtifacts.js';
import systemControlRouter from './api/systemControl.js';
import builderRouter from './api/builderApi.js';
import communityRouter from './api/communityApi.js';
import sharingRouter from './api/sharingApi.js';
import { ensureDir } from './util/safeFs.js';
import { getJobsBasePath, getFontsPath } from './jobs/paths.js';
import { DEFAULT_PORT, DEFAULT_HOST, DEFAULT_CORS_ORIGIN } from './constants.js';
import { initializeProfileStore } from './storage/profileStore.js';
import { getJobManager } from './jobs/jobManager.js';
import { serverLogger, dockerLogger, apiLogger } from './util/logger.js';

// Load environment variables from process.env (with constants as defaults)
const PORT = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
const HOST = process.env.HOST || DEFAULT_HOST;
const CORS_ORIGIN = process.env.CORS_ORIGIN || DEFAULT_CORS_ORIGIN;

async function main() {
  // Ensure required directories exist
  const jobsPath = getJobsBasePath();
  const fontsPath = getFontsPath();

  serverLogger.info('Kometa Preview Studio - Backend');
  serverLogger.info('================================');
  serverLogger.info({ jobsPath }, 'Jobs directory configured');
  serverLogger.info({ fontsPath }, 'Fonts directory configured');

  await ensureDir(jobsPath);

  // Initialize profile store (loads saved profiles from disk)
  await initializeProfileStore();

  // Create Express app
  const app = express();

  // Middleware
  app.use(cors({
    origin: CORS_ORIGIN,
    credentials: true,
  }));

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Multer for file uploads
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
      // Accept YAML files
      if (file.mimetype === 'application/x-yaml' ||
          file.mimetype === 'text/yaml' ||
          file.mimetype === 'text/plain' ||
          file.originalname.endsWith('.yml') ||
          file.originalname.endsWith('.yaml')) {
        cb(null, true);
      } else {
        cb(new Error('Only YAML files are allowed'));
      }
    },
  });

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
    });
  });

  // API routes
  app.use('/api/config', upload.single('config'), configRouter);
  app.use('/api/plex', plexRouter);
  app.use('/api/preview', previewStartRouter);
  app.use('/api/preview', previewStatusRouter);
  app.use('/api/preview', previewArtifactsRouter);
  app.use('/api/builder', builderRouter);
  app.use('/api/community', communityRouter);
  app.use('/api/share', sharingRouter);
  app.use('/api', systemControlRouter);

  // Error handling middleware
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    apiLogger.error({ err, path: req.path, method: req.method }, 'Unhandled error');

    // Handle multer errors
    if (err.name === 'MulterError') {
      res.status(400).json({
        error: 'File upload error',
        details: err.message,
      });
      return;
    }

    res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred',
    });
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not found',
      path: req.path,
    });
  });

  // Start server
  app.listen(PORT, HOST, () => {
    serverLogger.info({ host: HOST, port: PORT }, `Server running at http://${HOST}:${PORT}`);
    serverLogger.info('API Endpoints:');
    serverLogger.info('  POST /api/config           - Upload/paste Kometa config');
    serverLogger.info('  GET  /api/config/:id       - Get saved profile');
    serverLogger.info('  POST /api/preview/start    - Start preview job');
    serverLogger.info('  GET  /api/preview/status/:id - Get job status');
    serverLogger.info('  GET  /api/preview/events/:id - SSE stream of job events');
    serverLogger.info('  GET  /api/preview/artifacts/:id - Get job artifacts');
    serverLogger.info('  GET  /api/preview/image/:id/:folder/:file - Serve image');
    serverLogger.info('  GET  /api/preview/logs/:id - Get job logs');
    serverLogger.info('Ready to accept requests.');

    // Pre-pull Docker image in background (non-blocking)
    // This ensures the first preview job doesn't wait for image download
    prePullDockerImageInBackground();
  });
}

/**
 * Pre-pull the Kometa renderer Docker image in the background
 * This runs after server startup to ensure fast first preview
 */
async function prePullDockerImageInBackground(): Promise<void> {
  const jobManager = getJobManager();

  // First check if Docker is available
  const dockerAvailable = await jobManager.checkDockerAvailable();
  if (!dockerAvailable) {
    dockerLogger.warn('Docker is not available. Image pre-pull skipped.');
    dockerLogger.warn('Preview jobs will fail until Docker is running.');
    return;
  }

  dockerLogger.info('Checking renderer image availability...');

  try {
    const wasPulled = await jobManager.prePullDockerImage((message) => {
      dockerLogger.info(message);
    });

    if (wasPulled) {
      dockerLogger.info('Renderer image pre-pull complete. Ready for preview jobs.');
    } else {
      dockerLogger.info('Renderer image already available. Ready for preview jobs.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    dockerLogger.error({ err: error }, `Failed to pre-pull image: ${message}`);
    dockerLogger.warn('First preview job may be slow while the image downloads.');
  }
}

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  serverLogger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  serverLogger.error({ reason }, 'Unhandled rejection');
});

// Run
main().catch((err) => {
  serverLogger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
