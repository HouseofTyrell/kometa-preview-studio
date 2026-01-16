import { z } from 'zod';

/**
 * Zod schema for Kometa configuration validation
 * Validates the structure of uploaded config files
 */

// Plex configuration schema
const PlexConfigSchema = z.object({
  url: z.string().url('Plex URL must be a valid URL').optional(),
  token: z.string().min(1, 'Plex token is required').optional(),
  timeout: z.number().positive().optional(),
  clean_bundles: z.boolean().optional(),
  empty_trash: z.boolean().optional(),
  optimize: z.boolean().optional(),
}).optional();

// TMDb configuration schema
const TmdbConfigSchema = z.object({
  apikey: z.string().optional(),
  language: z.string().optional(),
  region: z.string().optional(),
  cache_expiration: z.number().optional(),
}).optional();

// Overlay file reference schema
const OverlayFileSchema = z.union([
  z.string(),
  z.object({
    default: z.string().optional(),
    pmm: z.string().optional(),
    file: z.string().optional(),
    url: z.string().url().optional(),
    git: z.string().optional(),
    repo: z.string().optional(),
    template_variables: z.record(z.unknown()).optional(),
  }).passthrough(),
]);

// Library configuration schema
const LibraryConfigSchema = z.object({
  overlay_files: z.array(OverlayFileSchema).optional(),
  collection_files: z.array(OverlayFileSchema).optional(),
  metadata_files: z.array(OverlayFileSchema).optional(),
  operations: z.record(z.unknown()).optional(),
  settings: z.record(z.unknown()).optional(),
}).passthrough();

// Settings schema
const SettingsSchema = z.object({
  cache: z.boolean().optional(),
  cache_expiration: z.number().optional(),
  asset_directory: z.union([z.string(), z.array(z.string())]).optional(),
  asset_folders: z.boolean().optional(),
  create_asset_folders: z.boolean().optional(),
  prioritize_assets: z.boolean().optional(),
  dimensional_asset_rename: z.boolean().optional(),
  download_url_assets: z.boolean().optional(),
  show_missing_season_assets: z.boolean().optional(),
  show_missing_episode_assets: z.boolean().optional(),
  show_asset_not_needed: z.boolean().optional(),
  sync_mode: z.enum(['append', 'sync']).optional(),
  minimum_items: z.number().optional(),
  delete_below_minimum: z.boolean().optional(),
  delete_not_scheduled: z.boolean().optional(),
  run_again_delay: z.number().optional(),
  missing_only_released: z.boolean().optional(),
  only_filter_missing: z.boolean().optional(),
  show_unmanaged: z.boolean().optional(),
  show_unconfigured: z.boolean().optional(),
  show_filtered: z.boolean().optional(),
  show_options: z.boolean().optional(),
  show_missing: z.boolean().optional(),
  save_report: z.boolean().optional(),
  tvdb_language: z.string().optional(),
  ignore_ids: z.array(z.union([z.string(), z.number()])).nullable().optional(),
  ignore_imdb_ids: z.array(z.string()).nullable().optional(),
  item_refresh_delay: z.number().optional(),
  verify_ssl: z.boolean().optional(),
  check_nightly: z.boolean().optional(),
  run_order: z.array(z.string()).optional(),
}).passthrough().optional();

// Main Kometa config schema
export const KometaConfigSchema = z.object({
  plex: PlexConfigSchema,
  tmdb: TmdbConfigSchema,
  libraries: z.record(LibraryConfigSchema).optional(),
  settings: SettingsSchema,
  webhooks: z.record(z.unknown()).optional(),
  tautulli: z.record(z.unknown()).optional(),
  omdb: z.record(z.unknown()).optional(),
  mdblist: z.record(z.unknown()).optional(),
  notifiarr: z.record(z.unknown()).optional(),
  anidb: z.record(z.unknown()).optional(),
  radarr: z.record(z.unknown()).optional(),
  sonarr: z.record(z.unknown()).optional(),
  trakt: z.record(z.unknown()).optional(),
  mal: z.record(z.unknown()).optional(),
}).passthrough();

export type ValidatedKometaConfig = z.infer<typeof KometaConfigSchema>;

/**
 * Validation result with structured errors
 */
export interface ConfigValidationResult {
  valid: boolean;
  config: ValidatedKometaConfig | null;
  errors: ConfigValidationError[];
}

export interface ConfigValidationError {
  path: string;
  message: string;
  code: string;
}

/**
 * Validate a Kometa config object
 * @param config - The parsed config object to validate
 * @returns Validation result with errors if invalid
 */
export function validateConfig(config: unknown): ConfigValidationResult {
  const result = KometaConfigSchema.safeParse(config);

  if (result.success) {
    return {
      valid: true,
      config: result.data,
      errors: [],
    };
  }

  // Transform Zod errors into structured format
  const errors: ConfigValidationError[] = result.error.issues.map((issue) => ({
    path: issue.path.join('.') || 'root',
    message: issue.message,
    code: issue.code,
  }));

  return {
    valid: false,
    config: null,
    errors,
  };
}

/**
 * Validate that a config has the minimum required fields for preview
 * @param config - The validated config
 * @returns Array of validation errors (empty if valid)
 */
export function validatePreviewRequirements(config: ValidatedKometaConfig): string[] {
  const errors: string[] = [];

  // Check for Plex URL
  if (!config.plex?.url) {
    errors.push('Plex URL is required for preview');
  }

  // Check for Plex token
  if (!config.plex?.token) {
    errors.push('Plex token is required for preview');
  }

  // Check for at least one library with overlays
  if (!config.libraries || Object.keys(config.libraries).length === 0) {
    errors.push('At least one library is required');
  } else {
    const hasOverlays = Object.values(config.libraries).some(
      (lib) => lib.overlay_files && lib.overlay_files.length > 0
    );
    if (!hasOverlays) {
      errors.push('At least one library must have overlay_files defined');
    }
  }

  return errors;
}
