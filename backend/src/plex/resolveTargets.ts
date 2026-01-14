import { PlexClient, PlexMediaItem } from './plexClient.js';
import { TestOptions, getMediaTypeKey } from '../types/testOptions.js';

/**
 * Preview metadata for fast overlay rendering without TMDb queries
 * These values are used for immediate preview, then optionally refined by real TMDb data
 */
export interface PreviewMetadata {
  // Streaming services (for streaming overlay)
  streaming?: string[];
  // TV network (for network overlay)
  network?: string;
  // Studio (for studio overlay)
  studio?: string;
  // Resolution info (for resolution overlay)
  resolution?: string;
  // Audio codec (for audio_codec overlay)
  audioCodec?: string;
  // HDR info
  hdr?: boolean;
  dolbyVision?: boolean;
  // Ratings (for ratings overlay)
  imdbRating?: number;
  tmdbRating?: number;
  rtRating?: number;
  // Status (for status overlay - shows only)
  status?: 'returning' | 'ended' | 'canceled' | 'airing';
  // Ribbon type (for ribbon overlay)
  ribbon?: string;
}

export interface PreviewTarget {
  id: string;
  label: string;
  type: 'movie' | 'show' | 'season' | 'episode';
  searchTitle: string;
  searchYear?: number;
  seasonIndex?: number;
  episodeIndex?: number;
  // Hardcoded metadata for fast preview rendering
  metadata?: PreviewMetadata;
}

export interface ResolvedTarget extends PreviewTarget {
  ratingKey: string;
  actualTitle: string;
  thumbPath: string;
  warnings: string[];
  // Parent relationship fields for mock library mode
  parentRatingKey?: string;
  grandparentRatingKey?: string;
  // Index fields for seasons/episodes
  index?: number;
  parentIndex?: number;
}

/**
 * Static preview targets for v0
 * Metadata is hardcoded for instant preview rendering without TMDb queries
 */
export const PREVIEW_TARGETS: PreviewTarget[] = [
  {
    id: 'matrix',
    label: 'The Matrix (1999) — Movie',
    type: 'movie',
    searchTitle: 'The Matrix',
    searchYear: 1999,
    metadata: {
      streaming: ['max'],  // HBO Max
      studio: 'Warner Bros. Pictures',
      resolution: '4K',
      audioCodec: 'DTS-HD MA',
      hdr: true,
      dolbyVision: true,
      imdbRating: 8.7,
      tmdbRating: 8.2,
      rtRating: 83,
      ribbon: 'imdb_top_250',
    },
  },
  {
    id: 'dune',
    label: 'Dune (2021) — Movie',
    type: 'movie',
    searchTitle: 'Dune',
    searchYear: 2021,
    metadata: {
      streaming: ['max', 'netflix'],
      studio: 'Legendary Pictures',
      resolution: '4K',
      audioCodec: 'Dolby Atmos',
      hdr: true,
      dolbyVision: true,
      imdbRating: 8.0,
      tmdbRating: 7.8,
      rtRating: 83,
      ribbon: 'imdb_top_250',
    },
  },
  {
    id: 'breakingbad_series',
    label: 'Breaking Bad — Series',
    type: 'show',
    searchTitle: 'Breaking Bad',
    metadata: {
      streaming: ['netflix', 'amc_plus'],
      network: 'AMC',
      studio: 'Sony Pictures Television',
      imdbRating: 9.5,
      tmdbRating: 8.9,
      rtRating: 96,
      status: 'ended',
      ribbon: 'imdb_top_250',
    },
  },
  {
    id: 'breakingbad_s01',
    label: 'Breaking Bad — Season 1',
    type: 'season',
    searchTitle: 'Breaking Bad',
    seasonIndex: 1,
    metadata: {
      streaming: ['netflix', 'amc_plus'],
      network: 'AMC',
      studio: 'Sony Pictures Television',
      resolution: '1080p',
    },
  },
  {
    id: 'breakingbad_s01e01',
    label: 'Breaking Bad — S01E01',
    type: 'episode',
    searchTitle: 'Breaking Bad',
    seasonIndex: 1,
    episodeIndex: 1,
    metadata: {
      streaming: ['netflix', 'amc_plus'],
      network: 'AMC',
      studio: 'Sony Pictures Television',
      resolution: '1080p',
      audioCodec: 'AAC',
      imdbRating: 9.0,
      tmdbRating: 8.5,
    },
  },
];

/**
 * Resolve all preview targets from Plex
 * @param client - Plex client instance
 * @param testOptions - Optional test options to filter targets
 */
export async function resolveTargets(
  client: PlexClient,
  testOptions?: TestOptions
): Promise<ResolvedTarget[]> {
  const results: ResolvedTarget[] = [];

  // Filter targets based on test options
  const targetsToResolve = filterTargets(PREVIEW_TARGETS, testOptions);

  // Cache for Breaking Bad show to avoid repeated searches
  let breakingBadShow: PlexMediaItem | null = null;
  let breakingBadSeason1: PlexMediaItem | null = null;

  for (const target of targetsToResolve) {
    const resolved = await resolveTarget(client, target, {
      breakingBadShow,
      breakingBadSeason1,
    });

    results.push(resolved);

    // Cache Breaking Bad items
    if (target.id === 'breakingbad_series' && resolved.ratingKey) {
      breakingBadShow = {
        ratingKey: resolved.ratingKey,
        key: `/library/metadata/${resolved.ratingKey}`,
        type: 'show',
        title: resolved.actualTitle,
        thumb: resolved.thumbPath,
      };
    }
    if (target.id === 'breakingbad_s01' && resolved.ratingKey) {
      breakingBadSeason1 = {
        ratingKey: resolved.ratingKey,
        key: `/library/metadata/${resolved.ratingKey}`,
        type: 'season',
        title: resolved.actualTitle,
        index: 1,
        thumb: resolved.thumbPath,
      };
    }
  }

  return results;
}

interface CachedItems {
  breakingBadShow: PlexMediaItem | null;
  breakingBadSeason1: PlexMediaItem | null;
}

/**
 * Resolve a single preview target
 */
async function resolveTarget(
  client: PlexClient,
  target: PreviewTarget,
  cache: CachedItems
): Promise<ResolvedTarget> {
  const warnings: string[] = [];
  let ratingKey = '';
  let actualTitle = '';
  let thumbPath = '';
  let parentRatingKey: string | undefined;
  let grandparentRatingKey: string | undefined;
  let index: number | undefined;
  let parentIndex: number | undefined;

  try {
    switch (target.type) {
      case 'movie': {
        const movies = await client.searchMovies(target.searchTitle, target.searchYear);
        if (movies.length === 0) {
          warnings.push(`Movie not found: ${target.searchTitle} (${target.searchYear})`);
        } else {
          const movie = selectBestMatch(movies, target.searchTitle, target.searchYear);
          ratingKey = movie.ratingKey;
          actualTitle = movie.title;
          thumbPath = movie.thumb || '';
          if (movies.length > 1) {
            warnings.push(
              `Multiple matches found for "${target.searchTitle}", selected: ${movie.title} (${movie.year})`
            );
          }
        }
        break;
      }

      case 'show': {
        const shows = await client.searchShows(target.searchTitle);
        if (shows.length === 0) {
          warnings.push(`Show not found: ${target.searchTitle}`);
        } else {
          const show = selectBestMatch(shows, target.searchTitle);
          ratingKey = show.ratingKey;
          actualTitle = show.title;
          thumbPath = show.thumb || '';
          if (shows.length > 1) {
            warnings.push(`Multiple matches found for "${target.searchTitle}", selected: ${show.title}`);
          }
        }
        break;
      }

      case 'season': {
        let show = cache.breakingBadShow;
        if (!show) {
          const shows = await client.searchShows(target.searchTitle);
          if (shows.length > 0) {
            show = selectBestMatch(shows, target.searchTitle);
          }
        }

        if (!show) {
          warnings.push(`Show not found for season: ${target.searchTitle}`);
        } else {
          const seasons = await client.getChildren(show.ratingKey);
          const season = seasons.find((s) => s.index === target.seasonIndex);
          if (!season) {
            warnings.push(`Season ${target.seasonIndex} not found for ${target.searchTitle}`);
          } else {
            ratingKey = season.ratingKey;
            actualTitle = `${show.title} - ${season.title}`;
            thumbPath = season.thumb || '';
            parentRatingKey = show.ratingKey;
            index = target.seasonIndex;
          }
        }
        break;
      }

      case 'episode': {
        let show = cache.breakingBadShow;
        if (!show) {
          const shows = await client.searchShows(target.searchTitle);
          if (shows.length > 0) {
            show = selectBestMatch(shows, target.searchTitle);
          }
        }

        if (!show) {
          warnings.push(`Show not found for episode: ${target.searchTitle}`);
        } else {
          let season = cache.breakingBadSeason1;
          if (!season || season.index !== target.seasonIndex) {
            const seasons = await client.getChildren(show.ratingKey);
            season = seasons.find((s) => s.index === target.seasonIndex) || null;
          }

          if (!season) {
            warnings.push(`Season ${target.seasonIndex} not found for ${target.searchTitle}`);
          } else {
            const episodes = await client.getChildren(season.ratingKey);
            const episode = episodes.find((e) => e.index === target.episodeIndex);
            if (!episode) {
              warnings.push(
                `Episode ${target.episodeIndex} not found in Season ${target.seasonIndex} of ${target.searchTitle}`
              );
            } else {
              ratingKey = episode.ratingKey;
              actualTitle = `${show.title} - S${String(target.seasonIndex).padStart(2, '0')}E${String(
                target.episodeIndex
              ).padStart(2, '0')} - ${episode.title}`;
              thumbPath = episode.thumb || '';
              parentRatingKey = season.ratingKey;
              grandparentRatingKey = show.ratingKey;
              index = target.episodeIndex;
              parentIndex = target.seasonIndex;
            }
          }
        }
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    warnings.push(`Error resolving ${target.label}: ${message}`);
  }

  return {
    ...target,
    ratingKey,
    actualTitle: actualTitle || target.label,
    thumbPath,
    warnings,
    parentRatingKey,
    grandparentRatingKey,
    index,
    parentIndex,
  };
}

/**
 * Select the best match from multiple results
 */
function selectBestMatch(
  items: PlexMediaItem[],
  targetTitle: string,
  targetYear?: number
): PlexMediaItem {
  if (items.length === 0) {
    throw new Error('No items to select from');
  }

  // Exact title match preferred
  const titleLower = targetTitle.toLowerCase();
  const exactTitleMatches = items.filter((i) => i.title.toLowerCase() === titleLower);

  if (exactTitleMatches.length === 1) {
    return exactTitleMatches[0];
  }

  // If year is provided, filter by year
  if (targetYear) {
    const yearMatches = (exactTitleMatches.length > 0 ? exactTitleMatches : items).filter(
      (i) => i.year === targetYear
    );
    if (yearMatches.length > 0) {
      return yearMatches[0];
    }
  }

  // Fall back to first result
  return exactTitleMatches.length > 0 ? exactTitleMatches[0] : items[0];
}

/**
 * Filter preview targets based on test options
 */
export function filterTargets(
  targets: PreviewTarget[],
  testOptions?: TestOptions
): PreviewTarget[] {
  if (!testOptions) {
    return targets;
  }

  let filtered = [...targets];

  // Filter by selected target IDs
  if (testOptions.selectedTargets.length > 0) {
    filtered = filtered.filter((t) => testOptions.selectedTargets.includes(t.id));
  }

  // Filter by media types
  if (testOptions.mediaTypes) {
    filtered = filtered.filter((t) => {
      const key = getMediaTypeKey(t.type);
      if (key === null) return true;
      return testOptions.mediaTypes[key];
    });
  }

  return filtered;
}

/**
 * Get available targets with their selection state
 */
export function getAvailableTargets(): Array<{
  id: string;
  label: string;
  type: string;
}> {
  return PREVIEW_TARGETS.map((t) => ({
    id: t.id,
    label: t.label,
    type: t.type,
  }));
}
