import * as path from 'path';
import { KometaConfig, stringifyYaml } from '../util/yaml.js';
import { ResolvedTarget } from '../plex/resolveTargets.js';
import { FetchedArtwork } from '../plex/fetchArtwork.js';

export interface GeneratedConfig {
  configYaml: string;
  rendererScript: string;  // Kept for interface compatibility (unused)
  targetMapping: Record<string, { inputPath: string; outputPath: string }>;
}

/**
 * Generate a valid Kometa config for preview rendering.
 *
 * This generates a REAL Kometa config that:
 * 1. Has valid Plex connection info
 * 2. Contains the user's overlay definitions
 * 3. Includes metadata about preview targets for the renderer
 *
 * The renderer will run Kometa with write blocking to capture outputs.
 */
export function generatePreviewConfig(
  originalConfig: KometaConfig,
  targets: ResolvedTarget[],
  artwork: FetchedArtwork[],
  jobPaths: { inputDir: string; outputDir: string; configDir: string }
): GeneratedConfig {
  // Create target mapping for input/output files
  const targetMapping: Record<string, { inputPath: string; outputPath: string }> = {};

  for (const target of targets) {
    const art = artwork.find((a) => a.targetId === target.id);
    if (art && art.localPath) {
      targetMapping[target.id] = {
        inputPath: `/jobs/input/${target.id}.jpg`,
        outputPath: `/jobs/output/${target.id}_after.png`,
      };
    }
  }

  // Generate a valid Kometa config
  const previewConfig = buildKometaConfig(originalConfig, targets, targetMapping);
  const configYaml = stringifyYaml(previewConfig);

  // The renderer script is no longer used - kept for interface compatibility
  const rendererScript = '';

  return {
    configYaml,
    rendererScript,
    targetMapping,
  };
}

/**
 * Build a valid Kometa configuration file.
 *
 * This produces a config that Kometa can actually run.
 * The renderer's write-blocker will prevent any Plex modifications.
 */
function buildKometaConfig(
  originalConfig: KometaConfig,
  targets: ResolvedTarget[],
  targetMapping: Record<string, { inputPath: string; outputPath: string }>
): Record<string, unknown> {
  const config: Record<string, unknown> = {};

  // Copy Plex section - required for Kometa to connect and process overlays
  if (originalConfig.plex) {
    config.plex = {
      url: originalConfig.plex.url,
      token: originalConfig.plex.token,
      timeout: originalConfig.plex.timeout || 60,
      clean_bundles: false,
      empty_trash: false,
      optimize: false,
    };
  }

  // Settings optimized for preview mode
  config.settings = {
    cache: false,
    cache_expiration: 0,
    asset_folders: false,
    create_asset_folders: false,
    prioritize_assets: false,
    dimensional_asset_rename: false,
    download_url_assets: false,
    show_missing_season_assets: false,
    show_missing_episode_assets: false,
    show_asset_not_needed: false,
    sync_mode: 'append',
    minimum_items: 0,
    default_collection_order: null,
    delete_below_minimum: false,
    delete_not_scheduled: false,
    run_again_delay: 0,
    missing_only_released: false,
    only_filter_missing: false,
    show_unmanaged: false,
    show_unconfigured: false,
    show_filtered: false,
    show_options: false,
    show_missing: false,
    save_report: false,
    tvdb_language: 'default',
    ignore_ids: [],
    ignore_imdb_ids: [],
    item_refresh_delay: 0,
    playlist_sync_to_user: null,
    playlist_exclude_users: null,
    playlist_report: false,
    verify_ssl: originalConfig.settings?.verify_ssl ?? false,
    custom_repo: null,
    check_nightly: false,
    // Run only overlays
    run_order: ['overlays'],
  };

  // Copy libraries with overlay definitions
  if (originalConfig.libraries) {
    const libraries: Record<string, unknown> = {};

    for (const [libName, libConfig] of Object.entries(originalConfig.libraries)) {
      if (libConfig.overlay_files) {
        libraries[libName] = {
          overlay_files: libConfig.overlay_files,
          // Disable other operations for preview
          operations: null,
          collections: null,
          metadata: null,
        };
      }
    }

    if (Object.keys(libraries).length > 0) {
      config.libraries = libraries;
    }
  }

  // Add preview metadata section (used by the renderer)
  config.preview = {
    mode: 'write_blocked',
    targets: targets.map((t) => ({
      id: t.id,
      type: t.type,
      title: t.actualTitle,
      input: targetMapping[t.id]?.inputPath,
      output: targetMapping[t.id]?.outputPath,
    })),
  };

  return config;
}

/**
 * Extract overlay specifications from config (for reference)
 */
function extractOverlaySpecs(config: KometaConfig): Record<string, unknown> {
  const specs: Record<string, unknown> = {};

  if (config.libraries) {
    for (const [libName, libConfig] of Object.entries(config.libraries)) {
      if (libConfig.overlay_files) {
        specs[libName] = {
          overlay_files: libConfig.overlay_files,
        };
      }
    }
  }

  return specs;
}
