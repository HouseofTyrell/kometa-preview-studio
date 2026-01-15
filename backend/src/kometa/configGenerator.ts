import * as path from 'path';
import { KometaConfig, stringifyYaml } from '../util/yaml.js';
import { ResolvedTarget } from '../plex/resolveTargets.js';
import { FetchedArtwork } from '../plex/fetchArtwork.js';
import { TestOptions } from '../types/testOptions.js';

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
 *
 * @param originalConfig - The original Kometa config
 * @param targets - Resolved preview targets
 * @param artwork - Fetched artwork for targets
 * @param jobPaths - Job directory paths
 * @param testOptions - Optional test options for selective testing
 */
export function generatePreviewConfig(
  originalConfig: KometaConfig,
  targets: ResolvedTarget[],
  artwork: FetchedArtwork[],
  jobPaths: { inputDir: string; outputDir: string; configDir: string },
  testOptions?: TestOptions
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

  // Generate a valid Kometa config (with optional library/overlay filtering)
  const previewConfig = buildKometaConfig(originalConfig, targets, targetMapping, testOptions);
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
 *
 * @param originalConfig - The original Kometa config
 * @param targets - Resolved preview targets
 * @param targetMapping - Mapping of target IDs to input/output paths
 * @param testOptions - Optional test options for filtering libraries/overlays
 */
function buildKometaConfig(
  originalConfig: KometaConfig,
  targets: ResolvedTarget[],
  targetMapping: Record<string, { inputPath: string; outputPath: string }>,
  testOptions?: TestOptions
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

  // Copy TMDb section - required for many overlay operations (ratings, etc.)
  if ((originalConfig as Record<string, unknown>).tmdb) {
    config.tmdb = (originalConfig as Record<string, unknown>).tmdb;
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

  // Copy libraries with overlay definitions (filtered by test options)
  // SKIP this entirely if manual mode is enabled - manual mode bypasses Kometa's builder
  // and uses instant_compositor directly, so library definitions are unnecessary and slow
  const isManualMode = testOptions?.manualBuilderConfig?.enabled === true;

  if (!isManualMode && originalConfig.libraries) {
    const libraries: Record<string, unknown> = {};

    for (const [libName, libConfig] of Object.entries(originalConfig.libraries)) {
      // Filter by selected libraries if specified
      if (testOptions?.selectedLibraries && testOptions.selectedLibraries.length > 0) {
        if (!testOptions.selectedLibraries.includes(libName)) {
          continue;
        }
      }

      if (libConfig.overlay_files) {
        // Filter overlay files if specified
        let overlayFiles = libConfig.overlay_files;
        if (testOptions?.selectedOverlays && testOptions.selectedOverlays.length > 0) {
          overlayFiles = filterOverlayFiles(overlayFiles, testOptions.selectedOverlays);
        }

        // Inject local file paths for default overlays to avoid 404 downloads
        overlayFiles = injectLocalOverlayAssets(overlayFiles);

        // Only include library if it has overlays after filtering
        if (overlayFiles.length > 0) {
          // CRITICAL: Only include overlay_files here. Do NOT add operations, collections,
          // or metadata keys (even as null/empty). Kometa's config validator rejects configs
          // that have these keys present in the main config file - it expects them to be in
          // external YAML files. Including them causes the error:
          //   "The 'Movies' library config contains collections definitions.
          //    These belong in external YAML files, not in the config.yml."
          // This validation error was causing jobs to fail at the Kometa config parsing stage.
          libraries[libName] = {
            overlay_files: overlayFiles,
          };
        }
      }
    }

    if (Object.keys(libraries).length > 0) {
      config.libraries = libraries;
    }
  }

  // Add preview metadata section (used by the renderer)
  // IMPORTANT: ratingKey is required for deterministic output mapping
  // Parent ratingKeys are required for mock library mode to return synthetic children
  // Metadata is used for instant overlay application without TMDb queries
  const previewSection: Record<string, unknown> = {
    mode: 'write_blocked',
    targets: targets.map((t) => {
      const target: Record<string, unknown> = {
        id: t.id,
        type: t.type,
        title: t.actualTitle,
        ratingKey: t.ratingKey,  // Required for mapping captured uploads to targets
        input: targetMapping[t.id]?.inputPath,
        output: targetMapping[t.id]?.outputPath,
      };
      // Include parent relationships for mock library mode
      if (t.parentRatingKey) {
        target.parentRatingKey = t.parentRatingKey;
      }
      if (t.grandparentRatingKey) {
        target.grandparentRatingKey = t.grandparentRatingKey;
      }
      // Include index fields for seasons/episodes
      if (t.index !== undefined) {
        target.index = t.index;
      }
      if (t.parentIndex !== undefined) {
        target.parentIndex = t.parentIndex;
      }
      // Include hardcoded metadata for instant preview (skips TMDb queries)
      if (t.metadata) {
        target.metadata = t.metadata;
      }
      return target;
    }),
  };

  // Add manual builder config if enabled - this tells the renderer to skip Kometa
  // and use instant_compositor directly with the specified overlays
  if (testOptions?.manualBuilderConfig?.enabled) {
    previewSection.manual_mode = true;
    previewSection.manual_overlays = {
      resolution: testOptions.manualBuilderConfig.resolution ?? false,
      audio_codec: testOptions.manualBuilderConfig.audioCodec ?? false,
      hdr: testOptions.manualBuilderConfig.hdr ?? false,
      ratings: testOptions.manualBuilderConfig.ratings ?? false,
      streaming: testOptions.manualBuilderConfig.streaming ?? false,
      network: testOptions.manualBuilderConfig.network ?? false,
      studio: testOptions.manualBuilderConfig.studio ?? false,
      status: testOptions.manualBuilderConfig.status ?? false,
      ribbon: {
        imdb_top_250: testOptions.manualBuilderConfig.ribbon?.imdbTop250 ?? false,
        imdb_lowest: testOptions.manualBuilderConfig.ribbon?.imdbLowest ?? false,
        rt_certified_fresh: testOptions.manualBuilderConfig.ribbon?.rtCertifiedFresh ?? false,
      },
    };
  }

  config.preview = previewSection;

  return config;
}

/**
 * Filter overlay files based on selected overlays
 * @param overlayFiles - Array of overlay file references
 * @param selectedOverlays - Array of selected overlay identifiers
 */
/**
 * Inject local file paths for default overlays to avoid 404 downloads
 * Kometa v2.2.2 has a bug where it constructs incorrect paths for overlay assets.
 * This function adds file_<key> template variables pointing to local assets.
 *
 * NOTE: Most overlays (audio_codec, ribbon, streaming, network, studio, ratings)
 * are dynamically generated by Kometa using PIL/ImageMagick and don't need PNG files.
 * Only resolution overlays use downloaded PNG assets from Default-Images repository.
 */
function injectLocalOverlayAssets(
  overlayFiles: Array<string | Record<string, unknown>>
): Array<string | Record<string, unknown>> {
  // Only resolution overlays use downloaded PNG files
  // Other overlays (audio_codec, ratings, etc.) are dynamically generated
  const overlayAssetMappings: Record<string, Record<string, string>> = {
    resolution: {
      file_4k: '/overlay-assets/resolution/resolution/4k.png',
      file_1080p: '/overlay-assets/resolution/resolution/1080p.png',
      file_720p: '/overlay-assets/resolution/resolution/720p.png',
      file_480p: '/overlay-assets/resolution/resolution/480p.png',
      file_fullhd: '/overlay-assets/resolution/resolution/fullhd.png',
      file_ultrahd: '/overlay-assets/resolution/resolution/ultrahd.png',
    },
  };

  return overlayFiles.map((overlayFile) => {
    if (typeof overlayFile !== 'object' || overlayFile === null) {
      return overlayFile;
    }

    // Check if this is a default overlay
    const defaultKey = (overlayFile as Record<string, unknown>).default;
    if (typeof defaultKey !== 'string') {
      return overlayFile;
    }

    // Get the asset mappings for this overlay type
    const assetPaths = overlayAssetMappings[defaultKey];
    if (!assetPaths) {
      return overlayFile;
    }

    // Clone the overlay file object and merge in local file paths
    const enhanced = { ...overlayFile };
    const existingVars = (enhanced.template_variables as Record<string, unknown>) || {};
    enhanced.template_variables = {
      ...existingVars,
      ...assetPaths,
    };

    return enhanced;
  });
}

function filterOverlayFiles(
  overlayFiles: Array<string | Record<string, unknown>>,
  selectedOverlays: string[]
): Array<string | Record<string, unknown>> {
  return overlayFiles.filter((overlayFile) => {
    if (typeof overlayFile === 'string') {
      // Direct path: check if the path matches any selected overlay
      return selectedOverlays.some((selected) =>
        overlayFile.includes(selected) || selected.includes(overlayFile)
      );
    } else if (typeof overlayFile === 'object' && overlayFile !== null) {
      // Object format: { pmm: "...", file: "...", etc. }
      const keys = Object.keys(overlayFile);
      for (const key of keys) {
        const value = String((overlayFile as Record<string, unknown>)[key]);
        const identifier = `${key}: ${value}`;
        if (selectedOverlays.includes(identifier) || selectedOverlays.includes(value)) {
          return true;
        }
      }
      return false;
    }
    return false;
  });
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
