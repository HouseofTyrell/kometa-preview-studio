/**
 * TMDb API client for fetching clean poster images
 *
 * Used as a source for "before" images when asset directories and
 * Original Posters backups are not available.
 */

import * as https from 'https';

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/original';

export interface TmdbConfig {
  apiKey: string;
}

/**
 * Well-known TMDb IDs for preview targets
 * These are hardcoded to avoid API calls for known items
 */
export const KNOWN_TMDB_IDS: Record<string, { id: number; type: 'movie' | 'tv' }> = {
  // Movies
  'matrix': { id: 603, type: 'movie' },
  'dune': { id: 438631, type: 'movie' },
  // TV Shows
  'breakingbad_series': { id: 1396, type: 'tv' },
  'breakingbad_s01': { id: 1396, type: 'tv' },
  'breakingbad_s01e01': { id: 1396, type: 'tv' },
};

/**
 * Make HTTPS request and return JSON response
 */
function makeRequest<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data) as T);
        } catch (err) {
          reject(new Error(`Failed to parse response: ${err}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Download image from URL
 */
function downloadImage(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          downloadImage(redirectUrl).then(resolve).catch(reject);
          return;
        }
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      res.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
    }).on('error', reject);
  });
}

interface TmdbMovieResponse {
  poster_path?: string;
}

interface TmdbTvResponse {
  poster_path?: string;
}

interface TmdbSeasonResponse {
  poster_path?: string;
}

interface TmdbEpisodeResponse {
  still_path?: string;
}

interface TmdbSearchResponse {
  results?: Array<{ poster_path?: string }>;
}

/**
 * TMDb API client
 */
export class TmdbClient {
  private apiKey: string;

  constructor(config: TmdbConfig) {
    this.apiKey = config.apiKey;
  }

  private buildUrl(path: string): string {
    return `${TMDB_API_BASE}${path}?api_key=${this.apiKey}`;
  }

  /**
   * Get poster URL for a movie by TMDb ID
   */
  async getMoviePoster(tmdbId: number): Promise<string | null> {
    try {
      const data = await makeRequest<TmdbMovieResponse>(this.buildUrl(`/movie/${tmdbId}`));
      if (data.poster_path) {
        return `${TMDB_IMAGE_BASE}${data.poster_path}`;
      }
      return null;
    } catch (err) {
      console.error(`TMDb: Failed to get movie poster for ${tmdbId}:`, err);
      return null;
    }
  }

  /**
   * Get poster URL for a TV show by TMDb ID
   */
  async getTvShowPoster(tmdbId: number): Promise<string | null> {
    try {
      const data = await makeRequest<TmdbTvResponse>(this.buildUrl(`/tv/${tmdbId}`));
      if (data.poster_path) {
        return `${TMDB_IMAGE_BASE}${data.poster_path}`;
      }
      return null;
    } catch (err) {
      console.error(`TMDb: Failed to get TV show poster for ${tmdbId}:`, err);
      return null;
    }
  }

  /**
   * Get poster URL for a TV season
   */
  async getSeasonPoster(tvId: number, seasonNumber: number): Promise<string | null> {
    try {
      const data = await makeRequest<TmdbSeasonResponse>(
        this.buildUrl(`/tv/${tvId}/season/${seasonNumber}`)
      );
      if (data.poster_path) {
        return `${TMDB_IMAGE_BASE}${data.poster_path}`;
      }
      // Fall back to show poster if season doesn't have one
      return this.getTvShowPoster(tvId);
    } catch (err) {
      console.error(`TMDb: Failed to get season poster for ${tvId} S${seasonNumber}:`, err);
      return null;
    }
  }

  /**
   * Get episode still image (landscape thumbnail)
   */
  async getEpisodeStill(
    tvId: number,
    seasonNumber: number,
    episodeNumber: number
  ): Promise<string | null> {
    try {
      const data = await makeRequest<TmdbEpisodeResponse>(
        this.buildUrl(`/tv/${tvId}/season/${seasonNumber}/episode/${episodeNumber}`)
      );
      if (data.still_path) {
        return `${TMDB_IMAGE_BASE}${data.still_path}`;
      }
      return null;
    } catch (err) {
      console.error(
        `TMDb: Failed to get episode still for ${tvId} S${seasonNumber}E${episodeNumber}:`,
        err
      );
      return null;
    }
  }

  /**
   * Search for a movie and get its poster
   */
  async searchMoviePoster(title: string, year?: number): Promise<string | null> {
    try {
      let url = this.buildUrl('/search/movie') + `&query=${encodeURIComponent(title)}`;
      if (year) {
        url += `&year=${year}`;
      }
      const data = await makeRequest<TmdbSearchResponse>(url);
      if (data.results && data.results.length > 0) {
        const posterPath = data.results[0].poster_path;
        if (posterPath) {
          return `${TMDB_IMAGE_BASE}${posterPath}`;
        }
      }
      return null;
    } catch (err) {
      console.error(`TMDb: Failed to search movie poster for "${title}":`, err);
      return null;
    }
  }

  /**
   * Search for a TV show and get its poster
   */
  async searchTvPoster(title: string): Promise<string | null> {
    try {
      const url = this.buildUrl('/search/tv') + `&query=${encodeURIComponent(title)}`;
      const data = await makeRequest<TmdbSearchResponse>(url);
      if (data.results && data.results.length > 0) {
        const posterPath = data.results[0].poster_path;
        if (posterPath) {
          return `${TMDB_IMAGE_BASE}${posterPath}`;
        }
      }
      return null;
    } catch (err) {
      console.error(`TMDb: Failed to search TV poster for "${title}":`, err);
      return null;
    }
  }

  /**
   * Download poster image to buffer
   */
  async downloadPoster(posterUrl: string): Promise<Buffer> {
    return downloadImage(posterUrl);
  }
}

/**
 * Create TMDb client from config
 */
export function createTmdbClient(config: { apikey?: string }): TmdbClient | null {
  if (!config.apikey) {
    return null;
  }
  return new TmdbClient({ apiKey: config.apikey });
}
