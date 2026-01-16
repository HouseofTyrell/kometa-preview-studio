/**
 * Preview targets for testing overlays
 *
 * NOTE: The authoritative source of truth for preview targets is the backend.
 * Use fetchPreviewTargets() to get the latest targets from the API.
 *
 * The static PREVIEW_TARGETS array below is kept for:
 * 1. Offline/fallback mode
 * 2. Type definitions
 * 3. Initial render before API response
 *
 * @see GET /api/preview/targets
 */

import { getPreviewTargets } from '../api/client';

export type MediaType = 'movie' | 'show' | 'season' | 'episode';

export interface PreviewMetadata {
  streaming?: string[];
  network?: string;
  studio?: string;
  resolution?: string;
  audioCodec?: string;
  hdr?: boolean;
  dolbyVision?: boolean;
  imdbRating?: number;
  tmdbRating?: number;
  rtRating?: number;
  status?: 'returning' | 'ended' | 'canceled' | 'airing';
  ribbon?: string;
  aspect?: string;
  languageCount?: number;
  languages?: string[];
  runtime?: number;
  version?: string;
  contentRating?: string;
  commonSenseAge?: number;
  mediaStinger?: boolean;
  directPlay?: boolean;
}

export interface PreviewTarget {
  id: string;
  label: string;
  type: MediaType;
  displayType: string; // Human-readable type for UI display
  metadata?: PreviewMetadata;
}

/**
 * Static preview targets
 * These mirror the backend PREVIEW_TARGETS in resolveTargets.ts
 */
export const PREVIEW_TARGETS: PreviewTarget[] = [
  {
    id: 'matrix',
    label: 'The Matrix (1999)',
    type: 'movie',
    displayType: 'Movie',
    metadata: {
      streaming: ['max'],
      studio: 'Warner Bros. Pictures',
      resolution: '4K',
      audioCodec: 'DTS-HD MA',
      hdr: true,
      dolbyVision: true,
      imdbRating: 8.7,
      tmdbRating: 8.2,
      rtRating: 83,
      ribbon: 'imdb_top_250',
      aspect: '2.35',
      languageCount: 12,
      languages: ['en', 'es', 'fr', 'de', 'it', 'ja'],
      runtime: 136,
      contentRating: 'R',
      commonSenseAge: 13,
      mediaStinger: false,
      directPlay: false,
    },
  },
  {
    id: 'dune',
    label: 'Dune (2021)',
    type: 'movie',
    displayType: 'Movie',
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
      aspect: '2.39',
      languageCount: 15,
      languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'zh'],
      runtime: 155,
      version: 'IMAX Enhanced',
      contentRating: 'PG-13',
      commonSenseAge: 13,
      mediaStinger: false,
      directPlay: false,
    },
  },
  {
    id: 'breakingbad_series',
    label: 'Breaking Bad',
    type: 'show',
    displayType: 'Series',
    metadata: {
      streaming: ['netflix', 'amc_plus'],
      network: 'AMC',
      studio: 'Sony Pictures Television',
      resolution: '1080p',
      audioCodec: 'AAC',
      hdr: false,
      imdbRating: 9.5,
      tmdbRating: 8.9,
      rtRating: 96,
      status: 'ended',
      ribbon: 'rt_certified_fresh',
      aspect: '1.78',
      languageCount: 8,
      languages: ['en', 'es', 'fr', 'de', 'it'],
      contentRating: 'TV-MA',
      commonSenseAge: 17,
      directPlay: false,
    },
  },
  {
    id: 'breakingbad_s01',
    label: 'Breaking Bad',
    type: 'season',
    displayType: 'Season 1',
    metadata: {
      streaming: ['netflix', 'amc_plus'],
      network: 'AMC',
      studio: 'Sony Pictures Television',
      resolution: '1080p',
      audioCodec: 'AAC',
      hdr: false,
      imdbRating: 9.2,
      tmdbRating: 8.7,
      rtRating: 93,
      ribbon: 'imdb_top_250',
      aspect: '1.78',
      languageCount: 8,
      languages: ['en', 'es', 'fr', 'de', 'it'],
      contentRating: 'TV-MA',
      directPlay: false,
    },
  },
  {
    id: 'breakingbad_s01e01',
    label: 'Breaking Bad',
    type: 'episode',
    displayType: 'S01E01',
    metadata: {
      streaming: ['netflix', 'amc_plus'],
      network: 'AMC',
      studio: 'Sony Pictures Television',
      resolution: '1080p',
      audioCodec: 'AAC',
      hdr: false,
      imdbRating: 9.0,
      tmdbRating: 8.5,
      rtRating: 88,
      aspect: '1.78',
      languageCount: 8,
      languages: ['en', 'es', 'fr', 'de', 'it'],
      contentRating: 'TV-MA',
      directPlay: false,
    },
  },
];

/**
 * Get targets filtered by media type flags
 */
export function filterTargetsByMediaType(
  targets: PreviewTarget[],
  mediaTypes: { movies: boolean; shows: boolean; seasons: boolean; episodes: boolean }
): PreviewTarget[] {
  return targets.filter((t) => {
    switch (t.type) {
      case 'movie':
        return mediaTypes.movies;
      case 'show':
        return mediaTypes.shows;
      case 'season':
        return mediaTypes.seasons;
      case 'episode':
        return mediaTypes.episodes;
      default:
        return true;
    }
  });
}

/**
 * Fetch preview targets from the backend API
 * This is the recommended way to get targets - ensures sync with backend
 *
 * @returns Promise<PreviewTarget[]> - Targets from API or fallback to static
 */
export async function fetchPreviewTargets(): Promise<PreviewTarget[]> {
  try {
    const response = await getPreviewTargets();
    return response.targets as PreviewTarget[];
  } catch (error) {
    console.warn('Failed to fetch preview targets from API, using fallback:', error);
    return PREVIEW_TARGETS;
  }
}
