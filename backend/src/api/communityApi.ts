import { Router, Request, Response } from 'express';

const router = Router();

interface GitHubContent {
  name: string;
  path: string;
  type: 'file' | 'dir';
  download_url?: string;
  size: number;
}

interface CommunityContributor {
  username: string;
  path: string;
  configCount: number;
}

// Cache for contributors with overlays (refreshed every 24 hours)
let contributorsWithOverlaysCache: CommunityContributor[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * GET /api/community/contributors-with-overlays
 * List only contributors who have configs with overlays (cached for performance)
 */
router.get('/contributors-with-overlays', async (req: Request, res: Response) => {
  try {
    const now = Date.now();

    // Return cached result if still valid
    if (contributorsWithOverlaysCache && (now - cacheTimestamp) < CACHE_DURATION) {
      console.log(`Returning cached contributors (${contributorsWithOverlaysCache.length} contributors)`);
      res.json({
        contributors: contributorsWithOverlaysCache,
        total: contributorsWithOverlaysCache.length,
        cached: true
      });
      return;
    }

    console.log('Fetching and filtering contributors with overlays...');

    // Fetch all contributors
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Kometa-Preview-Studio'
    };

    // Use GitHub token if available to increase rate limit (60 -> 5000 requests/hour)
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
    }

    const response = await fetch(
      'https://api.github.com/repos/Kometa-Team/Community-Configs/contents/',
      { headers }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    const contents = await response.json() as GitHubContent[];
    const allContributors = contents
      .filter(item => item.type === 'dir')
      .map(item => item.name);

    // Import yaml parser
    const yaml = await import('../util/yaml.js');

    // Filter to only contributors with overlay configs
    const filtered: CommunityContributor[] = [];

    for (const username of allContributors) {
      try {
        // Get contributor's configs
        const configsResponse = await fetch(
          `https://api.github.com/repos/Kometa-Team/Community-Configs/contents/${username}`,
          { headers }
        );

        if (!configsResponse.ok) continue;

        const configs = await configsResponse.json() as GitHubContent[];
        const yamlFiles = configs.filter(item =>
          item.type === 'file' &&
          (item.name.endsWith('.yml') || item.name.endsWith('.yaml'))
        );

        // Check first config for overlays (as a sample)
        if (yamlFiles.length > 0) {
          const firstConfig = yamlFiles[0];
          if (firstConfig.download_url) {
            const contentResponse = await fetch(firstConfig.download_url);
            if (contentResponse.ok) {
              const content = await contentResponse.text();
              const { parsed } = yaml.parseYaml(content);

              if (parsed) {
                const config = parsed as any;
                let hasOverlays = false;

                if (config.libraries) {
                  for (const [, libConfig] of Object.entries(config.libraries as Record<string, any>)) {
                    const typedConfig = libConfig as Record<string, any>;
                    if (typedConfig.overlay_files && Array.isArray(typedConfig.overlay_files) && typedConfig.overlay_files.length > 0) {
                      hasOverlays = true;
                      break;
                    }
                  }
                }

                if (hasOverlays) {
                  filtered.push({
                    username,
                    path: username,
                    configCount: yamlFiles.length
                  });
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn(`Failed to check contributor ${username}:`, err);
      }
    }

    // Update cache
    contributorsWithOverlaysCache = filtered;
    cacheTimestamp = now;

    console.log(`Found ${filtered.length} contributors with overlays`);

    res.json({
      contributors: filtered,
      total: filtered.length,
      cached: false
    });

  } catch (err) {
    console.error('Fetch contributors with overlays error:', err);
    res.status(500).json({
      error: 'Failed to fetch contributors with overlays',
      details: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/community/contributors
 * List all contributors from the Community-Configs repository
 */
router.get('/contributors', async (req: Request, res: Response) => {
  try {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Kometa-Preview-Studio'
    };
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
    }

    const response = await fetch(
      'https://api.github.com/repos/Kometa-Team/Community-Configs/contents/',
      { headers }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    const contents = await response.json() as GitHubContent[];

    // Filter to only directories (contributors)
    const contributors: CommunityContributor[] = contents
      .filter(item => item.type === 'dir')
      .map(item => ({
        username: item.name,
        path: item.path,
        configCount: 0 // Will be populated on individual contributor fetch
      }));

    res.json({
      contributors,
      total: contributors.length
    });

  } catch (err) {
    console.error('Fetch contributors error:', err);
    res.status(500).json({
      error: 'Failed to fetch community contributors',
      details: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/community/contributor/:username
 * Get configs from a specific contributor
 */
router.get('/contributor/:username', async (req: Request, res: Response) => {
  try {
    const { username } = req.params;

    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Kometa-Preview-Studio'
    };
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
    }

    const response = await fetch(
      `https://api.github.com/repos/Kometa-Team/Community-Configs/contents/${username}`,
      { headers }
    );

    if (!response.ok) {
      if (response.status === 404) {
        res.status(404).json({ error: 'Contributor not found' });
        return;
      }
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    const contents = await response.json() as GitHubContent[];

    // Filter YAML files
    const configs = contents
      .filter(item =>
        item.type === 'file' &&
        (item.name.endsWith('.yml') || item.name.endsWith('.yaml'))
      )
      .map(item => ({
        name: item.name,
        path: item.path,
        downloadUrl: item.download_url,
        size: item.size
      }));

    res.json({
      username,
      configs,
      total: configs.length
    });

  } catch (err) {
    console.error('Fetch contributor configs error:', err);
    res.status(500).json({
      error: 'Failed to fetch contributor configs',
      details: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/community/config/:username/:filename
 * Fetch raw config file content
 */
router.get('/config/:username/:filename', async (req: Request, res: Response) => {
  try {
    const { username, filename } = req.params;

    const headers: Record<string, string> = {
      'User-Agent': 'Kometa-Preview-Studio'
    };
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
    }

    // Fetch file content
    const response = await fetch(
      `https://raw.githubusercontent.com/Kometa-Team/Community-Configs/master/${username}/${filename}`,
      { headers }
    );

    if (!response.ok) {
      if (response.status === 404) {
        res.status(404).json({ error: 'Config file not found' });
        return;
      }
      throw new Error(`GitHub fetch error: ${response.statusText}`);
    }

    const content = await response.text();

    res.json({
      username,
      filename,
      content,
      url: `https://github.com/Kometa-Team/Community-Configs/blob/master/${username}/${filename}`
    });

  } catch (err) {
    console.error('Fetch config content error:', err);
    res.status(500).json({
      error: 'Failed to fetch config content',
      details: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/community/parse-overlays
 * Parse overlay configurations from YAML content
 */
router.post('/parse-overlays', async (req: Request, res: Response) => {
  try {
    const { yamlContent } = req.body;

    if (!yamlContent || typeof yamlContent !== 'string') {
      res.status(400).json({ error: 'yamlContent is required' });
      return;
    }

    // Import yaml parser
    const yaml = await import('../util/yaml.js');
    const { parsed, error } = yaml.parseYaml(yamlContent);

    if (error || !parsed) {
      res.status(400).json({ error: 'Failed to parse YAML', details: error });
      return;
    }

    // Extract overlay information
    const config = parsed as any;
    const overlays: string[] = [];

    // Check for overlay_files in libraries
    if (config.libraries) {
      for (const [libName, libConfig] of Object.entries(config.libraries as Record<string, any>)) {
        const typedConfig = libConfig as Record<string, any>;
        if (typedConfig.overlay_files && Array.isArray(typedConfig.overlay_files)) {
          overlays.push(...typedConfig.overlay_files.map((f: any) =>
            typeof f === 'string' ? f : JSON.stringify(f)
          ));
        }
      }
    }

    res.json({
      success: true,
      overlays: [...new Set(overlays)], // Remove duplicates
      libraryCount: config.libraries ? Object.keys(config.libraries).length : 0
    });

  } catch (err) {
    console.error('Parse overlays error:', err);
    res.status(500).json({
      error: 'Failed to parse overlays',
      details: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

export default router;
