import { Router, Request, Response } from 'express';
import { getProfileStore } from '../storage/profileStore.js';
import { parseYaml, stringifyYaml, type KometaConfig, type LibraryConfig } from '../util/yaml.js';
import { builderLogger } from '../util/logger.js';

const router = Router();

/**
 * GET /api/builder/overlays/:profileId
 * Extract overlay configurations from a profile's config
 */
router.get('/overlays/:profileId', async (req: Request, res: Response) => {
  try {
    const { profileId } = req.params;

    const store = getProfileStore();
    const profile = store.get(profileId);

    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    // Parse config
    const { parsed, error } = parseYaml(profile.configYaml);
    if (error || !parsed) {
      res.status(400).json({ error: 'Failed to parse config', details: error });
      return;
    }

    const config = parsed as KometaConfig;

    // Extract overlay files from all libraries
    const overlaysByLibrary: Record<string, Array<string | Record<string, unknown>>> = {};

    if (config.libraries) {
      for (const [libName, libConfig] of Object.entries(config.libraries)) {
        if (libConfig.overlay_files && libConfig.overlay_files.length > 0) {
          overlaysByLibrary[libName] = libConfig.overlay_files;
        }
      }
    }

    res.json({
      profileId,
      overlaysByLibrary,
      libraryNames: Object.keys(config.libraries || {}),
    });

  } catch (err) {
    builderLogger.error({ err }, 'Get overlays error');
    res.status(500).json({
      error: 'Failed to get overlays',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/builder/overlays/:profileId
 * Save overlay configurations back to a profile's config
 */
router.put('/overlays/:profileId', async (req: Request, res: Response) => {
  try {
    const { profileId } = req.params;
    const { overlaysByLibrary } = req.body as {
      overlaysByLibrary: Record<string, Array<string | Record<string, unknown>>>;
    };

    if (!overlaysByLibrary || typeof overlaysByLibrary !== 'object') {
      res.status(400).json({ error: 'overlaysByLibrary is required and must be an object' });
      return;
    }

    const store = getProfileStore();
    const profile = store.get(profileId);

    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    // Parse existing config
    const { parsed, error } = parseYaml(profile.configYaml);
    if (error || !parsed) {
      res.status(400).json({ error: 'Failed to parse config', details: error });
      return;
    }

    const config = parsed as KometaConfig;

    // Update overlay_files in each library
    if (!config.libraries) {
      config.libraries = {};
    }

    for (const [libName, overlayFiles] of Object.entries(overlaysByLibrary)) {
      if (!config.libraries[libName]) {
        config.libraries[libName] = { name: libName };
      }

      if (overlayFiles.length > 0) {
        config.libraries[libName].overlay_files = overlayFiles;
      } else {
        // Remove overlay_files if empty
        delete config.libraries[libName].overlay_files;
      }
    }

    // Convert back to YAML
    const updatedYaml = stringifyYaml(config);

    // Save updated profile
    store.set(profileId, {
      ...profile,
      configYaml: updatedYaml,
    });

    res.json({
      success: true,
      profileId,
      message: 'Overlays saved successfully',
    });

  } catch (err) {
    builderLogger.error({ err }, 'Save overlays error');
    res.status(500).json({
      error: 'Failed to save overlays',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/builder/export
 * Export builder configuration as JSON
 */
router.post('/export', async (req: Request, res: Response) => {
  try {
    const { enabledOverlays, selectedPreset, advancedOverlays, advancedQueues } = req.body;

    const exportData = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      enabledOverlays,
      selectedPreset,
      advancedOverlays,
      advancedQueues,
    };

    res.json(exportData);

  } catch (err) {
    builderLogger.error({ err }, 'Export error');
    res.status(500).json({
      error: 'Failed to export configuration',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/builder/import
 * Validate imported builder configuration
 */
router.post('/import', async (req: Request, res: Response) => {
  try {
    const importData = req.body;

    // Basic validation
    if (!importData || typeof importData !== 'object') {
      res.status(400).json({ error: 'Invalid import data' });
      return;
    }

    if (importData.version !== '1.0') {
      res.status(400).json({ error: 'Unsupported import version' });
      return;
    }

    // Validate structure
    const { enabledOverlays, selectedPreset, advancedOverlays, advancedQueues } = importData;

    if (enabledOverlays && typeof enabledOverlays !== 'object') {
      res.status(400).json({ error: 'Invalid enabledOverlays format' });
      return;
    }

    if (selectedPreset && typeof selectedPreset !== 'string') {
      res.status(400).json({ error: 'Invalid selectedPreset format' });
      return;
    }

    if (advancedOverlays && !Array.isArray(advancedOverlays)) {
      res.status(400).json({ error: 'Invalid advancedOverlays format' });
      return;
    }

    if (advancedQueues && !Array.isArray(advancedQueues)) {
      res.status(400).json({ error: 'Invalid advancedQueues format' });
      return;
    }

    res.json({
      valid: true,
      data: {
        enabledOverlays: enabledOverlays || {},
        selectedPreset: selectedPreset || 'top-left',
        advancedOverlays: advancedOverlays || [],
        advancedQueues: advancedQueues || [],
      },
    });

  } catch (err) {
    builderLogger.error({ err }, 'Import error');
    res.status(500).json({
      error: 'Failed to import configuration',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/builder/yaml/validate
 * Validate YAML syntax and structure
 */
router.post('/yaml/validate', async (req: Request, res: Response) => {
  try {
    const { yaml } = req.body as { yaml: string };

    if (!yaml || typeof yaml !== 'string') {
      res.status(400).json({ error: 'YAML content is required' });
      return;
    }

    const { parsed, error } = parseYaml(yaml);

    if (error) {
      res.json({
        valid: false,
        error,
      });
      return;
    }

    // Check for Kometa-specific structure
    const config = parsed as KometaConfig;
    const warnings: string[] = [];

    if (!config.plex) {
      warnings.push('Missing plex configuration section');
    }

    if (!config.libraries || Object.keys(config.libraries).length === 0) {
      warnings.push('No libraries defined');
    }

    res.json({
      valid: true,
      warnings: warnings.length > 0 ? warnings : undefined,
      libraries: config.libraries ? Object.keys(config.libraries) : [],
    });

  } catch (err) {
    builderLogger.error({ err }, 'YAML validation error');
    res.status(500).json({
      error: 'Failed to validate YAML',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/builder/yaml/parse-overlays
 * Parse YAML and extract overlay definitions
 */
router.post('/yaml/parse-overlays', async (req: Request, res: Response) => {
  try {
    const { yaml } = req.body as { yaml: string };

    if (!yaml || typeof yaml !== 'string') {
      res.status(400).json({ error: 'YAML content is required' });
      return;
    }

    const { parsed, error } = parseYaml(yaml);

    if (error || !parsed) {
      res.status(400).json({
        error: 'Invalid YAML',
        details: error,
      });
      return;
    }

    // Check if this is an overlay file (has 'overlays' key)
    const overlayFile = parsed as { overlays?: Record<string, unknown>; queues?: Record<string, unknown> };

    if (overlayFile.overlays) {
      // This is an overlay file
      const overlayNames = Object.keys(overlayFile.overlays);
      const queueNames = overlayFile.queues ? Object.keys(overlayFile.queues) : [];

      res.json({
        type: 'overlay_file',
        overlayCount: overlayNames.length,
        overlayNames,
        queueCount: queueNames.length,
        queueNames,
        overlays: overlayFile.overlays,
        queues: overlayFile.queues,
      });
      return;
    }

    // Check if this is a full Kometa config
    const config = parsed as KometaConfig;

    if (config.libraries) {
      // Extract overlays from libraries
      const overlaysByLibrary: Record<string, unknown[]> = {};

      for (const [libName, libConfig] of Object.entries(config.libraries)) {
        if (libConfig.overlay_files && Array.isArray(libConfig.overlay_files)) {
          overlaysByLibrary[libName] = libConfig.overlay_files;
        }
      }

      res.json({
        type: 'kometa_config',
        libraryCount: Object.keys(config.libraries).length,
        libraryNames: Object.keys(config.libraries),
        overlaysByLibrary,
        hasPlexConfig: !!config.plex,
        hasSettings: !!config.settings,
      });
      return;
    }

    // Unknown format
    res.json({
      type: 'unknown',
      keys: Object.keys(parsed),
    });

  } catch (err) {
    builderLogger.error({ err }, 'Parse overlays error');
    res.status(500).json({
      error: 'Failed to parse overlays',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/builder/yaml/generate-template
 * Generate a Kometa config template
 */
router.post('/yaml/generate-template', async (req: Request, res: Response) => {
  try {
    const {
      plexUrl,
      plexToken,
      libraries,
      includeSettings = true,
      includeTmdb = false,
    } = req.body as {
      plexUrl?: string;
      plexToken?: string;
      libraries?: Array<{ name: string; type: 'movie' | 'show' }>;
      includeSettings?: boolean;
      includeTmdb?: boolean;
    };

    const config: KometaConfig = {
      plex: {
        url: plexUrl || 'http://localhost:32400',
        token: plexToken || 'YOUR_PLEX_TOKEN',
        timeout: 60,
      },
      libraries: {},
    };

    // Add TMDb if requested
    if (includeTmdb) {
      config.tmdb = {
        apikey: 'YOUR_TMDB_API_KEY',
        language: 'en',
        region: 'US',
      };
    }

    // Add settings if requested
    if (includeSettings) {
      config.settings = {
        cache: true,
        cache_expiration: 60,
        asset_directory: ['config/assets'],
        asset_folders: true,
        sync_mode: 'append',
        show_unmanaged: true,
        show_missing: true,
      };
    }

    // Add libraries
    const libraryList = libraries || [{ name: 'Movies', type: 'movie' as const }];

    for (const lib of libraryList) {
      const libConfig: LibraryConfig = {
        name: lib.name,
      };

      // Add metadata_path based on type
      const metadataType = lib.type === 'movie' ? 'movies' : 'shows';
      libConfig.metadata_path = [`pmm: ${metadataType}`];

      // Add placeholder overlay_files
      libConfig.overlay_files = [
        '# Add your overlay files here',
        '# - pmm: resolution',
        '# - pmm: audio_codec',
        '# - file: config/overlays.yml',
      ];

      config.libraries![lib.name] = libConfig;
    }

    const yaml = stringifyYaml(config);

    // Add header comment
    const header = [
      '# Kometa Configuration',
      '# Generated by Kometa Preview Studio',
      `# Generated: ${new Date().toISOString()}`,
      '#',
      '# Documentation: https://kometa.wiki/',
      '',
    ].join('\n');

    res.json({
      yaml: header + yaml,
      libraryNames: libraryList.map(l => l.name),
    });

  } catch (err) {
    builderLogger.error({ err }, 'Generate template error');
    res.status(500).json({
      error: 'Failed to generate template',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/builder/yaml/:profileId
 * Update a profile's raw YAML config
 */
router.put('/yaml/:profileId', async (req: Request, res: Response) => {
  try {
    const { profileId } = req.params;
    const { yaml } = req.body as { yaml: string };

    if (!yaml || typeof yaml !== 'string') {
      res.status(400).json({ error: 'YAML content is required' });
      return;
    }

    // Validate YAML first
    const { parsed, error } = parseYaml(yaml);
    if (error || !parsed) {
      res.status(400).json({
        error: 'Invalid YAML syntax',
        details: error,
      });
      return;
    }

    const store = getProfileStore();
    const profile = store.get(profileId);

    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    // Update profile with new YAML
    store.set(profileId, {
      ...profile,
      configYaml: yaml,
      updatedAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      profileId,
      message: 'Config updated successfully',
    });

  } catch (err) {
    builderLogger.error({ err }, 'Update YAML error');
    res.status(500).json({
      error: 'Failed to update config',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/builder/yaml/:profileId
 * Get a profile's raw YAML config
 */
router.get('/yaml/:profileId', async (req: Request, res: Response) => {
  try {
    const { profileId } = req.params;

    const store = getProfileStore();
    const profile = store.get(profileId);

    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    res.json({
      profileId,
      yaml: profile.configYaml,
      updatedAt: profile.updatedAt,
    });

  } catch (err) {
    builderLogger.error({ err }, 'Get YAML error');
    res.status(500).json({
      error: 'Failed to get config',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;
