import { Router, Request, Response } from 'express';
import { parseYaml, analyzeConfig, KometaConfig, redactConfig } from '../util/yaml.js';
import { generateProfileId } from '../util/hash.js';

// In-memory profile storage for v0
interface Profile {
  id: string;
  configYaml: string;
  analysis: ReturnType<typeof analyzeConfig>;
  createdAt: string;
  updatedAt: string;
}

const profiles = new Map<string, Profile>();

const router = Router();

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
    const profile: Profile = {
      id: profileId,
      configYaml,
      analysis,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    profiles.set(profileId, profile);

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
  const profile = profiles.get(profileId);

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
router.put('/:profileId', (req: Request, res: Response) => {
  const { profileId } = req.params;
  const profile = profiles.get(profileId);

  if (!profile) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }

  const { configYaml } = req.body;

  if (!configYaml) {
    res.status(400).json({ error: 'configYaml is required' });
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
  profile.configYaml = configYaml;
  profile.analysis = analysis;
  profile.updatedAt = new Date().toISOString();

  res.json({
    profileId: profile.id,
    plexUrl: analysis.plexUrl,
    tokenPresent: analysis.tokenPresent,
    assetDirectories: analysis.assetDirectories,
    overlayFiles: analysis.overlayFiles,
    libraryNames: analysis.libraryNames,
    warnings: analysis.warnings,
    overlayYaml: analysis.overlayYaml,
    updatedAt: profile.updatedAt,
  });
});

/**
 * DELETE /api/config/:profileId
 * Delete a profile
 */
router.delete('/:profileId', (req: Request, res: Response) => {
  const { profileId } = req.params;

  if (!profiles.has(profileId)) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }

  profiles.delete(profileId);
  res.json({ success: true });
});

/**
 * GET /api/config/:profileId/raw
 * Get the raw config YAML (for internal use only - requires validation)
 */
router.get('/:profileId/raw', (req: Request, res: Response) => {
  const { profileId } = req.params;
  const profile = profiles.get(profileId);

  if (!profile) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }

  // Return raw config for job creation
  res.json({
    configYaml: profile.configYaml,
  });
});

// Export the profiles map for use by other modules
export { profiles };
export default router;
