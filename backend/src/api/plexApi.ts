import { Router, Request, Response } from 'express';
import { PlexClient } from '../plex/plexClient.js';

const router = Router();

/**
 * POST /api/plex/test
 * Test Plex connection and return server info + libraries
 */
router.post('/test', async (req: Request, res: Response) => {
  try {
    const { plexUrl, plexToken } = req.body;

    // Validate inputs
    if (!plexUrl || typeof plexUrl !== 'string') {
      res.status(400).json({ error: 'plexUrl is required' });
      return;
    }
    if (!plexToken || typeof plexToken !== 'string') {
      res.status(400).json({ error: 'plexToken is required' });
      return;
    }

    // Validate URL format
    try {
      new URL(plexUrl);
    } catch {
      res.status(400).json({ error: 'Invalid URL format' });
      return;
    }

    const client = new PlexClient({
      url: plexUrl.trim(),
      token: plexToken.trim(),
      timeout: 10000, // 10 second timeout for connection test
    });

    // Test connection
    const connected = await client.testConnection();
    if (!connected) {
      res.status(400).json({
        success: false,
        error: 'Could not connect to Plex server. Check your URL and token.',
      });
      return;
    }

    // Get libraries
    const sections = await client.getLibrarySections();
    const libraries = sections.map((s) => ({
      key: s.key,
      title: s.title,
      type: s.type,
    }));

    res.json({
      success: true,
      libraries,
      message: `Connected! Found ${libraries.length} ${libraries.length === 1 ? 'library' : 'libraries'}.`,
    });
  } catch (err) {
    console.error('Plex connection test error:', err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Connection failed',
    });
  }
});

export default router;
