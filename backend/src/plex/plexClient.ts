import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

export interface PlexMediaItem {
  ratingKey: string;
  key: string;
  type: 'movie' | 'show' | 'season' | 'episode';
  title: string;
  year?: number;
  index?: number; // season/episode number
  parentIndex?: number; // season number for episode
  thumb?: string;
  art?: string;
  grandparentTitle?: string; // show title for episode
  parentTitle?: string; // season title for episode
}

export interface PlexSearchResult {
  items: PlexMediaItem[];
  totalSize: number;
}

export interface PlexClientConfig {
  url: string;  // Plex server URL
  token: string;
  timeout?: number;
}

// Internal interface for Plex list response
interface PlexListResponse {
  MediaContainer: {
    Metadata?: Array<{
      ratingKey: string;
      key: string;
      type: string;
      title: string;
      year?: number;
      thumb?: string;
      art?: string;
    }>;
  };
}

/**
 * Plex API client for fetching metadata and artwork
 */
export class PlexClient {
  private baseUrl: string;
  private token: string;
  private timeout: number;

  constructor(config: PlexClientConfig) {
    this.baseUrl = config.url.replace(/\/$/, '');
    this.token = config.token;
    this.timeout = config.timeout || 30000;
  }

  /**
   * Make a request to Plex API
   */
  private async request<T>(path: string): Promise<T> {
    const url = new URL(path, this.baseUrl);
    url.searchParams.set('X-Plex-Token', this.token);

    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    return new Promise((resolve, reject) => {
      const req = httpModule.request(
        url,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
          timeout: this.timeout,
          rejectUnauthorized: false, // Allow self-signed certs for local Plex
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(data) as T);
              } catch {
                reject(new Error(`Failed to parse Plex response: ${data.slice(0, 200)}`));
              }
            } else {
              reject(new Error(`Plex API error: ${res.statusCode} - ${data.slice(0, 200)}`));
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Plex request timeout'));
      });

      req.end();
    });
  }

  /**
   * Get library sections
   */
  async getLibrarySections(): Promise<Array<{ key: string; type: string; title: string }>> {
    interface PlexSectionsResponse {
      MediaContainer: {
        Directory?: Array<{
          key: string;
          type: string;
          title: string;
        }>;
      };
    }

    const response = await this.request<PlexSectionsResponse>('/library/sections');
    return response.MediaContainer?.Directory || [];
  }

  /**
   * Generic search by media type
   * Searches library sections matching the specified type
   *
   * @param sectionType - The library section type ('movie' or 'show')
   * @param itemType - The item type to match in results
   * @param title - The title to search for
   * @returns Array of matching media items
   */
  private async searchByType(
    sectionType: 'movie' | 'show',
    itemType: 'movie' | 'show',
    title: string
  ): Promise<PlexMediaItem[]> {
    // Get sections matching the type
    const sections = await this.getLibrarySections();
    const matchingSections = sections.filter(s => s.type === sectionType);

    const allItems: PlexMediaItem[] = [];
    const titleLower = title.toLowerCase();

    for (const section of matchingSections) {
      const items = await this.searchInSection(section.key, itemType, titleLower, title);
      allItems.push(...items);
    }

    return allItems;
  }

  /**
   * Search within a specific library section
   * Tries title-filtered search first, falls back to listing all items
   */
  private async searchInSection(
    sectionKey: string,
    itemType: 'movie' | 'show',
    titleLower: string,
    originalTitle: string
  ): Promise<PlexMediaItem[]> {
    const items: PlexMediaItem[] = [];

    try {
      // Try section-specific title search first
      const searchPath = `/library/sections/${sectionKey}/all?title=${encodeURIComponent(originalTitle)}`;
      const response = await this.request<PlexListResponse>(searchPath);
      const metadata = response.MediaContainer?.Metadata || [];

      for (const m of metadata) {
        if (m.type === itemType && m.title.toLowerCase().includes(titleLower)) {
          items.push(this.mapToMediaItem(m, itemType));
        }
      }
    } catch {
      // If section search fails, try listing all (for smaller libraries)
      const listPath = `/library/sections/${sectionKey}/all`;
      const response = await this.request<PlexListResponse>(listPath);
      const metadata = response.MediaContainer?.Metadata || [];

      for (const m of metadata) {
        if (m.type === itemType && m.title.toLowerCase().includes(titleLower)) {
          items.push(this.mapToMediaItem(m, itemType));
        }
      }
    }

    return items;
  }

  /**
   * Map Plex API response to PlexMediaItem
   */
  private mapToMediaItem(
    m: NonNullable<PlexListResponse['MediaContainer']['Metadata']>[number],
    type: 'movie' | 'show'
  ): PlexMediaItem {
    return {
      ratingKey: m.ratingKey,
      key: m.key,
      type,
      title: m.title,
      year: m.year,
      thumb: m.thumb,
      art: m.art,
    };
  }

  /**
   * Search for movies by title and optional year
   * Uses section-based listing with title filtering for reliability
   */
  async searchMovies(title: string, year?: number): Promise<PlexMediaItem[]> {
    const allItems = await this.searchByType('movie', 'movie', title);

    // Filter by year if provided
    if (year) {
      const exactMatch = allItems.filter((i) => i.year === year);
      if (exactMatch.length > 0) {
        return exactMatch;
      }
    }

    return allItems;
  }

  /**
   * Search for TV shows by title
   * Uses section-based listing with title filtering for reliability
   */
  async searchShows(title: string): Promise<PlexMediaItem[]> {
    return this.searchByType('show', 'show', title);
  }

  /**
   * Get children of an item (seasons for show, episodes for season)
   */
  async getChildren(ratingKey: string): Promise<PlexMediaItem[]> {
    interface PlexChildrenResponse {
      MediaContainer: {
        Metadata?: Array<{
          ratingKey: string;
          key: string;
          type: string;
          title: string;
          index?: number;
          parentIndex?: number;
          thumb?: string;
          art?: string;
          grandparentTitle?: string;
          parentTitle?: string;
        }>;
      };
    }

    const childrenPath = `/library/metadata/${ratingKey}/children`;
    const response = await this.request<PlexChildrenResponse>(childrenPath);
    const metadata = response.MediaContainer?.Metadata || [];

    return metadata.map((m) => ({
      ratingKey: m.ratingKey,
      key: m.key,
      type: m.type as PlexMediaItem['type'],
      title: m.title,
      index: m.index,
      parentIndex: m.parentIndex,
      thumb: m.thumb,
      art: m.art,
      grandparentTitle: m.grandparentTitle,
      parentTitle: m.parentTitle,
    }));
  }

  /**
   * Get item metadata by rating key
   */
  async getMetadata(ratingKey: string): Promise<PlexMediaItem | null> {
    interface PlexMetadataResponse {
      MediaContainer: {
        Metadata?: Array<{
          ratingKey: string;
          key: string;
          type: string;
          title: string;
          year?: number;
          index?: number;
          parentIndex?: number;
          thumb?: string;
          art?: string;
          grandparentTitle?: string;
          parentTitle?: string;
        }>;
      };
    }

    const metadataPath = `/library/metadata/${ratingKey}`;
    const response = await this.request<PlexMetadataResponse>(metadataPath);
    const item = response.MediaContainer?.Metadata?.[0];

    if (!item) return null;

    return {
      ratingKey: item.ratingKey,
      key: item.key,
      type: item.type as PlexMediaItem['type'],
      title: item.title,
      year: item.year,
      index: item.index,
      parentIndex: item.parentIndex,
      thumb: item.thumb,
      art: item.art,
      grandparentTitle: item.grandparentTitle,
      parentTitle: item.parentTitle,
    };
  }

  /**
   * Get full URL for artwork with token
   */
  getArtworkUrl(thumbPath: string): string {
    if (!thumbPath) return '';
    const url = new URL(thumbPath, this.baseUrl);
    url.searchParams.set('X-Plex-Token', this.token);
    return url.toString();
  }

  /**
   * Download artwork to buffer
   */
  async downloadArtwork(thumbPath: string): Promise<Buffer> {
    const url = new URL(thumbPath, this.baseUrl);
    url.searchParams.set('X-Plex-Token', this.token);

    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    return new Promise((resolve, reject) => {
      const req = httpModule.request(
        url,
        {
          method: 'GET',
          timeout: this.timeout,
          rejectUnauthorized: false,
        },
        (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            // Handle redirect
            const redirectUrl = res.headers.location;
            if (redirectUrl) {
              this.downloadFromUrl(redirectUrl).then(resolve).catch(reject);
              return;
            }
          }

          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            const chunks: Buffer[] = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
          } else {
            reject(new Error(`Failed to download artwork: ${res.statusCode}`));
          }
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Artwork download timeout'));
      });

      req.end();
    });
  }

  /**
   * Download from an arbitrary URL
   */
  private async downloadFromUrl(urlString: string): Promise<Buffer> {
    const url = new URL(urlString);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    return new Promise((resolve, reject) => {
      const req = httpModule.request(
        url,
        {
          method: 'GET',
          timeout: this.timeout,
          rejectUnauthorized: false,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            const chunks: Buffer[] = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
          } else {
            reject(new Error(`Failed to download: ${res.statusCode}`));
          }
        }
      );

      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Test connection to Plex server
   */
  async testConnection(): Promise<boolean> {
    try {
      interface PlexIdentityResponse {
        MediaContainer: {
          machineIdentifier?: string;
          version?: string;
        };
      }
      const response = await this.request<PlexIdentityResponse>('/identity');
      return !!response.MediaContainer?.machineIdentifier;
    } catch {
      return false;
    }
  }
}
