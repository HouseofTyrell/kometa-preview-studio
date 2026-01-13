import express from 'express';
import cors from 'cors';
import multer from 'multer';
import * as path from 'path';
import configRouter from './api/configUpload.js';
import previewStartRouter from './api/previewStart.js';
import previewStatusRouter from './api/previewStatus.js';
import previewArtifactsRouter from './api/previewArtifacts.js';
import { ensureDir } from './util/safeFs.js';
import { getJobsBasePath, getFontsPath } from './jobs/paths.js';

// Load environment variables from process.env
const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '127.0.0.1';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

async function main() {
  // Ensure required directories exist
  const jobsPath = getJobsBasePath();
  const fontsPath = getFontsPath();

  console.log('Kometa Preview Studio - Backend');
  console.log('================================');
  console.log(`Jobs directory: ${jobsPath}`);
  console.log(`Fonts directory: ${fontsPath}`);

  await ensureDir(jobsPath);

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
  app.use('/api/preview', previewStartRouter);
  app.use('/api/preview', previewStatusRouter);
  app.use('/api/preview', previewArtifactsRouter);

  // Error handling middleware
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled error:', err);

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
    console.log(`\nServer running at http://${HOST}:${PORT}`);
    console.log(`\nAPI Endpoints:`);
    console.log(`  POST /api/config           - Upload/paste Kometa config`);
    console.log(`  GET  /api/config/:id       - Get saved profile`);
    console.log(`  POST /api/preview/start    - Start preview job`);
    console.log(`  GET  /api/preview/status/:id - Get job status`);
    console.log(`  GET  /api/preview/events/:id - SSE stream of job events`);
    console.log(`  GET  /api/preview/artifacts/:id - Get job artifacts`);
    console.log(`  GET  /api/preview/image/:id/:folder/:file - Serve image`);
    console.log(`  GET  /api/preview/logs/:id - Get job logs`);
    console.log(`\nReady to accept requests.\n`);
  });
}

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});

// Run
main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
