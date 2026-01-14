import { Router, Request, Response } from 'express';
import { parseYaml, analyzeConfig, KometaConfig } from '../util/yaml.js';
import { generateProfileId } from '../util/hash.js';
import { getProfileStore, ProfileData } from '../storage/profileStore.js';

const router = Router();

/**
 * Generate a minimal Kometa config from Plex credentials
 */
function generateMinimalConfig(plexUrl: string, plexToken: string): string {
  return `# Kometa Preview Studio - Generated Config
# Created: ${new Date().toISOString()}

plex:
  url: ${plexUrl}
  token: ${plexToken}
  timeout: 60

settings:
  cache: true
  cache_expiration: 60

# Add your libraries below
# Example:
# libraries:
#   Movies:
#     overlay_files:
#       - pmm: resolution
`;
}

/**
 * POST /api/config/new
 * Create a new config from Plex credentials (start from scratch)
 */
router.post('/new', async (req: Request, res: Response) => {
  try {
    const { plexUrl, plexToken } = req.body;

    // Validate inputs
    if (!plexUrl || typeof plexUrl !== 'string') {
      res.status(400).json({ error: 'plexUrl is required and must be a string' });
      return;
    }
    if (!plexToken || typeof plexToken !== 'string') {
      res.status(400).json({ error: 'plexToken is required and must be a string' });
      return;
    }

    // Validate URL format
    try {
      new URL(plexUrl);
    } catch {
      res.status(400).json({ error: 'Invalid URL format for plexUrl' });
      return;
    }

    // Generate minimal config
    const configYaml = generateMinimalConfig(plexUrl.trim(), plexToken.trim());

    // Parse and analyze (should succeed since we generated valid YAML)
    const parsed = parseYaml(configYaml);
    if (!parsed.parsed) {
      res.status(500).json({ error: 'Failed to generate valid config' });
      return;
    }

    const config = parsed.parsed as KometaConfig;
    const analysis = analyzeConfig(config);

    // Create profile
    const profileId = generateProfileId();
    const profile: ProfileData = {
      id: profileId,
      configYaml,
      analysis,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const store = getProfileStore();
    await store.set(profileId, profile);

    // Return both analysis and the generated config
    res.json({
      analysis: {
        profileId,
        plexUrl: analysis.plexUrl,
        tokenPresent: analysis.tokenPresent,
        assetDirectories: analysis.assetDirectories,
        overlayFiles: analysis.overlayFiles,
        libraryNames: analysis.libraryNames,
        warnings: analysis.warnings,
        overlayYaml: analysis.overlayYaml,
      },
      configYaml,
    });

  } catch (err) {
    console.error('Config creation error:', err);
    res.status(500).json({
      error: 'Failed to create configuration',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/config
 * Upload or paste a Kometa config.yml
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    let configYaml: string;

    // Handle both file upload and JSON body
    if (req.file) {
      configYaml = req.file.buffer.toString('utf-8');
    } else if (req.body?.configYaml) {
      // Validate configYaml is a string
      if (typeof req.body.configYaml !== 'string') {
        res.status(400).json({ error: 'configYaml must be a string' });
        return;
      }
      configYaml = req.body.configYaml;
    } else {
      res.status(400).json({
        error: 'No config provided. Upload a file or send configYaml in request body.',
      });
      return;
    }

    // Parse YAML
    const parsed = parseYaml(configYaml);

    if (parsed.error) {
      res.status(400).json({
        error: 'Invalid YAML syntax',
        details: parsed.error,
      });
      return;
    }

    if (!parsed.parsed) {
      res.status(400).json({
        error: 'Empty configuration',
      });
      return;
    }

    const config = parsed.parsed as KometaConfig;

    // Analyze the config
    const analysis = analyzeConfig(config);

    // Create profile
    const profileId = generateProfileId();
    const profile: ProfileData = {
      id: profileId,
      configYaml,
      analysis,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const store = getProfileStore();
    await store.set(profileId, profile);

    // Return analysis (without sensitive data)
    res.json({
      profileId,
      plexUrl: analysis.plexUrl,
      tokenPresent: analysis.tokenPresent,
      assetDirectories: analysis.assetDirectories,
      overlayFiles: analysis.overlayFiles,
      libraryNames: analysis.libraryNames,
      warnings: analysis.warnings,
      overlayYaml: analysis.overlayYaml,
    });

  } catch (err) {
    console.error('Config upload error:', err);
    res.status(500).json({
      error: 'Failed to process configuration',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/config/:profileId
 * Get a saved profile
 */
router.get('/:profileId', (req: Request, res: Response) => {
  const { profileId } = req.params;
  const store = getProfileStore();
  const profile = store.get(profileId);

  if (!profile) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }

  res.json({
    profileId: profile.id,
    plexUrl: profile.analysis.plexUrl,
    tokenPresent: profile.analysis.tokenPresent,
    assetDirectories: profile.analysis.assetDirectories,
    overlayFiles: profile.analysis.overlayFiles,
    libraryNames: profile.analysis.libraryNames,
    warnings: profile.analysis.warnings,
    overlayYaml: profile.analysis.overlayYaml,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  });
});

/**
 * PUT /api/config/:profileId
 * Update a profile's config
 */
router.put('/:profileId', async (req: Request, res: Response) => {
  const { profileId } = req.params;
  const store = getProfileStore();
  const profile = store.get(profileId);

  if (!profile) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }

  const { configYaml } = req.body;

  if (!configYaml) {
    res.status(400).json({ error: 'configYaml is required' });
    return;
  }

  if (typeof configYaml !== 'string') {
    res.status(400).json({ error: 'configYaml must be a string' });
    return;
  }

  // Parse and validate
  const parsed = parseYaml(configYaml);

  if (parsed.error) {
    res.status(400).json({
      error: 'Invalid YAML syntax',
      details: parsed.error,
    });
    return;
  }

  const config = parsed.parsed as KometaConfig;
  const analysis = analyzeConfig(config);

  // Update profile
  const updatedProfile: ProfileData = {
    ...profile,
    configYaml,
    analysis,
    updatedAt: new Date().toISOString(),
  };

  await store.set(profileId, updatedProfile);

  res.json({
    profileId: updatedProfile.id,
    plexUrl: analysis.plexUrl,
    tokenPresent: analysis.tokenPresent,
    assetDirectories: analysis.assetDirectories,
    overlayFiles: analysis.overlayFiles,
    libraryNames: analysis.libraryNames,
    warnings: analysis.warnings,
    overlayYaml: analysis.overlayYaml,
    updatedAt: updatedProfile.updatedAt,
  });
});

/**
 * DELETE /api/config/:profileId
 * Delete a profile
 */
router.delete('/:profileId', async (req: Request, res: Response) => {
  const { profileId } = req.params;
  const store = getProfileStore();

  if (!store.has(profileId)) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }

  await store.delete(profileId);
  res.json({ success: true });
});

/**
 * GET /api/config/:profileId/raw
 * Get the raw config YAML (for internal use only - requires validation)
 */
router.get('/:profileId/raw', (req: Request, res: Response) => {
  const { profileId } = req.params;
  const store = getProfileStore();
  const profile = store.get(profileId);

  if (!profile) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }

  // Return raw config for job creation
  res.json({
    configYaml: profile.configYaml,
  });
});

export default router;
