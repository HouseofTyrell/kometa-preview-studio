import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

// Directory to store shared configs
const SHARES_DIR = path.join(process.cwd(), 'data', 'shares');

// Ensure shares directory exists
async function ensureSharesDir() {
  try {
    await fs.mkdir(SHARES_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create shares directory:', error);
  }
}

interface SharedConfig {
  id: string;
  config: {
    enabledOverlays: Record<string, boolean>;
    selectedPreset: string | null;
    advancedOverlays: unknown[];
    advancedQueues: unknown[];
  };
  metadata: {
    title?: string;
    description?: string;
    author?: string;
    createdAt: string;
  };
}

/**
 * POST /api/share/create
 * Create a shareable link for an overlay configuration
 */
router.post('/create', async (req: Request, res: Response) => {
  try {
    await ensureSharesDir();

    const { config, metadata } = req.body;

    if (!config) {
      res.status(400).json({ error: 'Config is required' });
      return;
    }

    // Generate a unique share ID
    const shareId = crypto.randomBytes(8).toString('hex');

    const sharedConfig: SharedConfig = {
      id: shareId,
      config,
      metadata: {
        ...metadata,
        createdAt: new Date().toISOString(),
      },
    };

    // Save to file
    const filePath = path.join(SHARES_DIR, `${shareId}.json`);
    await fs.writeFile(filePath, JSON.stringify(sharedConfig, null, 2), 'utf-8');

    res.json({
      success: true,
      shareId,
      shareUrl: `/share/${shareId}`,
    });
  } catch (err) {
    console.error('Share creation error:', err);
    res.status(500).json({
      error: 'Failed to create share',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/share/:shareId
 * Get a shared configuration by ID
 */
router.get('/:shareId', async (req: Request, res: Response) => {
  try {
    const { shareId } = req.params;

    // Validate shareId format (hex string)
    if (!/^[a-f0-9]+$/i.test(shareId)) {
      res.status(400).json({ error: 'Invalid share ID format' });
      return;
    }

    const filePath = path.join(SHARES_DIR, `${shareId}.json`);

    try {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const sharedConfig: SharedConfig = JSON.parse(fileContent);

      res.json({
        success: true,
        ...sharedConfig,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        res.status(404).json({ error: 'Share not found' });
        return;
      }
      throw error;
    }
  } catch (err) {
    console.error('Share retrieval error:', err);
    res.status(500).json({
      error: 'Failed to retrieve share',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/share/gist
 * Export configuration to GitHub Gist
 */
router.post('/gist', async (req: Request, res: Response) => {
  try {
    const { config, metadata, githubToken } = req.body;

    if (!config) {
      res.status(400).json({ error: 'Config is required' });
      return;
    }

    const gistContent = {
      description: metadata?.description || 'Kometa Overlay Configuration',
      public: true,
      files: {
        'overlay-config.json': {
          content: JSON.stringify(
            {
              config,
              metadata: {
                ...metadata,
                createdAt: new Date().toISOString(),
                exportedFrom: 'Kometa Preview Studio',
              },
            },
            null,
            2
          ),
        },
      },
    };

    // If GitHub token provided, use authenticated API
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Kometa-Preview-Studio',
    };

    if (githubToken) {
      headers['Authorization'] = `token ${githubToken}`;
    }

    const response = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers,
      body: JSON.stringify(gistContent),
    });

    if (!response.ok) {
      const error = await response.json() as { message?: string };
      throw new Error(error.message || `GitHub API error: ${response.statusText}`);
    }

    const gist = await response.json() as {
      id: string;
      html_url: string;
      files: Record<string, { raw_url: string }>;
    };

    res.json({
      success: true,
      gistId: gist.id,
      gistUrl: gist.html_url,
      rawUrl: gist.files['overlay-config.json'].raw_url,
    });
  } catch (err) {
    console.error('Gist creation error:', err);
    res.status(500).json({
      error: 'Failed to create gist',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/share/gist/:gistId
 * Import configuration from GitHub Gist
 */
router.get('/gist/:gistId', async (req: Request, res: Response) => {
  try {
    const { gistId } = req.params;

    const response = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: {
        'User-Agent': 'Kometa-Preview-Studio',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        res.status(404).json({ error: 'Gist not found' });
        return;
      }
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    const gist = await response.json() as {
      files: Record<string, { raw_url: string }>;
    };
    const file = gist.files['overlay-config.json'];

    if (!file) {
      res.status(400).json({ error: 'Gist does not contain overlay-config.json' });
      return;
    }

    // Fetch the raw content
    const rawResponse = await fetch(file.raw_url);
    const content = await rawResponse.text();
    const data = JSON.parse(content);

    res.json({
      success: true,
      ...data,
    });
  } catch (err) {
    console.error('Gist retrieval error:', err);
    res.status(500).json({
      error: 'Failed to retrieve gist',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/share/list
 * List all shares (for admin/debugging)
 */
router.get('/list/all', async (req: Request, res: Response) => {
  try {
    await ensureSharesDir();

    const files = await fs.readdir(SHARES_DIR);
    const shares = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const filePath = path.join(SHARES_DIR, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const share = JSON.parse(content);
        shares.push({
          id: share.id,
          metadata: share.metadata,
        });
      } catch (error) {
        console.error(`Failed to read share ${file}:`, error);
      }
    }

    res.json({
      success: true,
      shares,
      total: shares.length,
    });
  } catch (err) {
    console.error('List shares error:', err);
    res.status(500).json({
      error: 'Failed to list shares',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;
