import { Router, Request, Response } from 'express';
import { getProfileStore } from '../storage/profileStore.js';
import { parseYaml, stringifyYaml, type KometaConfig, type LibraryConfig } from '../util/yaml.js';

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
    console.error('Get overlays error:', err);
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
    console.error('Save overlays error:', err);
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
    console.error('Export error:', err);
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
    console.error('Import error:', err);
    res.status(500).json({
      error: 'Failed to import configuration',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;
