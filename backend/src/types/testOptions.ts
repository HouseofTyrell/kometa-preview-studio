/**
 * Test options for selective preview testing
 * Allows users to customize which targets, libraries, and overlays to test
 */

export interface MediaTypeFilters {
  movies: boolean;
  shows: boolean;
  seasons: boolean;
  episodes: boolean;
}

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
}

/**
 * Custom target definition for user-specified media items
 * (Future feature - not implemented in Phase 1)
 */
export interface CustomTarget {
  type: 'movie' | 'show' | 'season' | 'episode';
  searchTitle: string;
  searchYear?: number;
  seasonIndex?: number;
  episodeIndex?: number;
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
};

/**
 * Map media type string to filter key
 */
export function getMediaTypeKey(type: string): keyof MediaTypeFilters | null {
  switch (type) {
    case 'movie':
      return 'movies';
    case 'show':
      return 'shows';
    case 'season':
      return 'seasons';
    case 'episode':
      return 'episodes';
    default:
      return null;
  }
}
