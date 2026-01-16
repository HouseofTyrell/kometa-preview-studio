/**
 * Test options for selective preview testing
 * Mirrors the backend types for consistency
 */

export interface MediaTypeFilters {
  movies: boolean;
  shows: boolean;
  seasons: boolean;
  episodes: boolean;
}

/**
 * Manual builder configuration for fast preview rendering.
 *
 * When enabled, bypasses Kometa's external builders (IMDb, TMDb, Trakt, etc.)
 * and directly applies selected overlays to preview targets using their
 * hardcoded metadata. This reduces preview time from 30-60+ seconds to ~2 seconds.
 */
export interface ManualBuilderConfig {
  enabled: boolean;
  resolution?: boolean;
  audioCodec?: boolean;
  hdr?: boolean;
  ratings?: boolean;
  streaming?: boolean;
  network?: boolean;
  studio?: boolean;
  status?: boolean;
  ribbon?: {
    imdbTop250?: boolean;
    imdbLowest?: boolean;
    rtCertifiedFresh?: boolean;
  };
}

/**
 * Default manual builder configuration - disabled with all overlays off
 */
export const DEFAULT_MANUAL_BUILDER_CONFIG: ManualBuilderConfig = {
  enabled: false,
  resolution: false,
  audioCodec: false,
  hdr: false,
  ratings: false,
  streaming: false,
  network: false,
  studio: false,
  status: false,
  ribbon: {
    imdbTop250: false,
    imdbLowest: false,
    rtCertifiedFresh: false,
  },
};

export interface TestOptions {
  /**
   * IDs of specific targets to include (from PREVIEW_TARGETS)
   * Empty array means "all targets"
   */
  selectedTargets: string[];

  /**
   * Media type filters - which types of media to include
   */
  mediaTypes: MediaTypeFilters;

  /**
   * Library names to include (from config analysis)
   * Empty array means "all libraries"
   */
  selectedLibraries: string[];

  /**
   * Overlay file paths/identifiers to include
   * Empty array means "all overlays"
   */
  selectedOverlays: string[];

  /**
   * Manual builder configuration for fast preview mode.
   * When enabled, applies overlays directly without external API calls.
   */
  manualBuilderConfig?: ManualBuilderConfig;

  /**
   * Use full Kometa builder mode (slower but more accurate).
   * When true, runs Kometa's full overlay builder pipeline including
   * external API calls, library scanning, and multi-level overlays.
   * When false (default), uses fast instant compositor for preview targets only.
   */
  useFullKometaBuilder?: boolean;
}

/**
 * Preview target info from backend
 */
export interface PreviewTargetInfo {
  id: string;
  label: string;
  type: string;
}

/**
 * Default test options - include everything
 */
export const DEFAULT_TEST_OPTIONS: TestOptions = {
  selectedTargets: [],
  mediaTypes: {
    movies: true,
    shows: true,
    seasons: true,
    episodes: true,
  },
  selectedLibraries: [],
  selectedOverlays: [],
  manualBuilderConfig: undefined,
};

/**
 * Check if any filters are active (not default)
 */
export function hasActiveFilters(options: TestOptions): boolean {
  const defaults = DEFAULT_TEST_OPTIONS;

  if (options.selectedTargets.length > 0) return true;
  if (options.selectedLibraries.length > 0) return true;
  if (options.selectedOverlays.length > 0) return true;

  // Check if any media type is disabled
  if (options.mediaTypes.movies !== defaults.mediaTypes.movies) return true;
  if (options.mediaTypes.shows !== defaults.mediaTypes.shows) return true;
  if (options.mediaTypes.seasons !== defaults.mediaTypes.seasons) return true;
  if (options.mediaTypes.episodes !== defaults.mediaTypes.episodes) return true;

  // Check if manual builder config is enabled
  if (options.manualBuilderConfig?.enabled) return true;

  return false;
}

/**
 * Get a summary of active filters for display
 */
export function getFilterSummary(options: TestOptions): string {
  const parts: string[] = [];

  // Check if manual builder mode is enabled
  if (options.manualBuilderConfig?.enabled) {
    parts.push('Manual Mode');
  }

  if (options.selectedTargets.length > 0) {
    parts.push(`${options.selectedTargets.length} target(s)`);
  }

  const activeMediaTypes = Object.entries(options.mediaTypes)
    .filter(([, enabled]) => enabled)
    .map(([type]) => type);
  if (activeMediaTypes.length < 4) {
    parts.push(activeMediaTypes.join(', '));
  }

  if (options.selectedLibraries.length > 0) {
    parts.push(`${options.selectedLibraries.length} library(ies)`);
  }

  if (options.selectedOverlays.length > 0) {
    parts.push(`${options.selectedOverlays.length} overlay(s)`);
  }

  return parts.length > 0 ? parts.join(' | ') : 'All items';
}
