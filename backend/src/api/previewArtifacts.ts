import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { getJobManager } from '../jobs/jobManager.js';
import { pathExists, safeResolve, readText } from '../util/safeFs.js';
import { getJobPaths } from '../jobs/paths.js';

const router = Router();

/**
 * GET /api/preview/artifacts/:jobId
 * Get URLs for job artifacts (before/after images, logs)
 */
router.get('/artifacts/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const jobManager = getJobManager();

    const artifacts = await jobManager.getJobArtifacts(jobId);

    if (!artifacts) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.json(artifacts);

  } catch (err) {
    console.error('Artifacts error:', err);
    res.status(500).json({
      error: 'Failed to get artifacts',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/preview/image/:jobId/:folder/:filename
 * Serve a specific image from job folder
 */
router.get('/image/:jobId/:folder/:filename', async (req: Request, res: Response) => {
  try {
    const { jobId, folder, filename } = req.params;

    // Validate folder
    if (folder !== 'input' && folder !== 'output') {
      res.status(400).json({ error: 'Invalid folder. Must be "input" or "output".' });
      return;
    }

    const jobManager = getJobManager();
    const imagePath = jobManager.getImagePath(jobId, folder, filename);

    if (!imagePath) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }

    if (!(await pathExists(imagePath))) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    // Determine content type
    const ext = path.extname(filename).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };

    const contentType = contentTypes[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    // Stream the file with error handling
    const stream = fs.createReadStream(imagePath);
    stream.on('error', (err) => {
      console.error('Stream error serving image:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read image file' });
      }
    });
    stream.pipe(res);

  } catch (err) {
    console.error('Image serve error:', err);
    res.status(500).json({
      error: 'Failed to serve image',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/preview/logs/:jobId
 * Get job logs
 */
router.get('/logs/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const jobManager = getJobManager();

    const logPath = jobManager.getLogPath(jobId);

    if (!(await pathExists(logPath))) {
      res.status(404).json({ error: 'Logs not found' });
      return;
    }

    const logs = await readText(logPath);

    res.setHeader('Content-Type', 'text/plain');
    res.send(logs || '');

  } catch (err) {
    console.error('Logs error:', err);
    res.status(500).json({
      error: 'Failed to get logs',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/preview/download/:jobId/:folder/:filename
 * Download an image file
 */
router.get('/download/:jobId/:folder/:filename', async (req: Request, res: Response) => {
  try {
    const { jobId, folder, filename } = req.params;

    // Validate folder
    if (folder !== 'input' && folder !== 'output') {
      res.status(400).json({ error: 'Invalid folder' });
      return;
    }

    const jobManager = getJobManager();
    const imagePath = jobManager.getImagePath(jobId, folder, filename);

    if (!imagePath) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }

    if (!(await pathExists(imagePath))) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    // Set download headers
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Stream the file with error handling
    const stream = fs.createReadStream(imagePath);
    stream.on('error', (err) => {
      console.error('Stream error during download:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read file' });
      }
    });
    stream.pipe(res);

  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({
      error: 'Failed to download file',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;
