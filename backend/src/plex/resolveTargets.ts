import { PlexClient, PlexMediaItem } from './plexClient.js';

export interface PreviewTarget {
  id: string;
  label: string;
  type: 'movie' | 'show' | 'season' | 'episode';
  searchTitle: string;
  searchYear?: number;
  seasonIndex?: number;
  episodeIndex?: number;
}

export interface ResolvedTarget extends PreviewTarget {
  ratingKey: string;
  actualTitle: string;
  thumbPath: string;
  warnings: string[];
}

/**
 * Static preview targets for v0
 */
export const PREVIEW_TARGETS: PreviewTarget[] = [
  {
    id: 'matrix',
    label: 'The Matrix (1999) — Movie',
    type: 'movie',
    searchTitle: 'The Matrix',
    searchYear: 1999,
  },
  {
    id: 'dune',
    label: 'Dune (2021) — Movie',
    type: 'movie',
    searchTitle: 'Dune',
    searchYear: 2021,
  },
  {
    id: 'breakingbad_series',
    label: 'Breaking Bad — Series',
    type: 'show',
    searchTitle: 'Breaking Bad',
  },
  {
    id: 'breakingbad_s01',
    label: 'Breaking Bad — Season 1',
    type: 'season',
    searchTitle: 'Breaking Bad',
    seasonIndex: 1,
  },
  {
    id: 'breakingbad_s01e01',
    label: 'Breaking Bad — S01E01',
    type: 'episode',
    searchTitle: 'Breaking Bad',
    seasonIndex: 1,
    episodeIndex: 1,
  },
];

/**
 * Resolve all preview targets from Plex
 */
export async function resolveTargets(client: PlexClient): Promise<ResolvedTarget[]> {
  const results: ResolvedTarget[] = [];

  // Cache for Breaking Bad show to avoid repeated searches
  let breakingBadShow: PlexMediaItem | null = null;
  let breakingBadSeason1: PlexMediaItem | null = null;

  for (const target of PREVIEW_TARGETS) {
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
