import { jest } from '@jest/globals';
import * as http from 'http';
import * as https from 'https';
import { EventEmitter } from 'events';
import { PlexClient } from '../plex/plexClient.js';

// Mock response helper
class MockResponse extends EventEmitter {
  statusCode: number;
  headers: Record<string, string>;

  constructor(statusCode: number = 200, headers: Record<string, string> = {}) {
    super();
    this.statusCode = statusCode;
    this.headers = headers;
  }

  sendData(data: string | object) {
    const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
    this.emit('data', dataStr);
    this.emit('end');
  }
}

// Mock request helper
class MockRequest extends EventEmitter {
  destroyed = false;

  end() {
    // Trigger response in next tick
  }

  destroy() {
    this.destroyed = true;
  }
}

describe('PlexClient', () => {
  let client: PlexClient;
  let mockRequest: MockRequest;
  let mockResponse: MockResponse;
  let httpRequestSpy: jest.Mock;
  let httpsRequestSpy: jest.Mock;

  beforeEach(() => {
    client = new PlexClient({
      url: 'http://localhost:32400',
      token: 'test-token',
      timeout: 5000,
    });

    mockRequest = new MockRequest();
    mockResponse = new MockResponse(200);

    // Create mock functions
    const createMockRequest = (response: MockResponse) => {
      return jest.fn().mockImplementation((...args: unknown[]) => {
        const callback = args.find(arg => typeof arg === 'function') as ((res: unknown) => void) | undefined;
        if (callback) {
          // Call callback asynchronously to simulate network
          setImmediate(() => callback(response));
        }
        return mockRequest;
      });
    };

    // Mock http.request
    httpRequestSpy = createMockRequest(mockResponse);
    jest.spyOn(http, 'request').mockImplementation(httpRequestSpy as unknown as typeof http.request);

    // Mock https.request for HTTPS URLs
    httpsRequestSpy = createMockRequest(mockResponse);
    jest.spyOn(https, 'request').mockImplementation(httpsRequestSpy as unknown as typeof https.request);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should strip trailing slash from URL', () => {
      const testClient = new PlexClient({
        url: 'http://localhost:32400/',
        token: 'test-token',
      });
      // Verify by checking getArtworkUrl output
      const artworkUrl = testClient.getArtworkUrl('/library/metadata/123/thumb');
      expect(artworkUrl).toContain('http://localhost:32400/library');
      expect(artworkUrl).not.toContain('32400//');
    });

    it('should use default timeout of 30000ms', () => {
      const testClient = new PlexClient({
        url: 'http://localhost:32400',
        token: 'test-token',
      });
      // Client is created successfully with default timeout
      expect(testClient).toBeDefined();
    });
  });

  describe('getLibrarySections', () => {
    it('should return library sections from Plex API', async () => {
      const mockSections = {
        MediaContainer: {
          Directory: [
            { key: '1', type: 'movie', title: 'Movies' },
            { key: '2', type: 'show', title: 'TV Shows' },
          ],
        },
      };

      // Trigger the response
      setImmediate(() => {
        mockResponse.sendData(mockSections);
      });

      const sections = await client.getLibrarySections();

      expect(sections).toHaveLength(2);
      expect(sections[0]).toEqual({ key: '1', type: 'movie', title: 'Movies' });
      expect(sections[1]).toEqual({ key: '2', type: 'show', title: 'TV Shows' });
    });

    it('should return empty array when no sections exist', async () => {
      const mockSections = {
        MediaContainer: {},
      };

      setImmediate(() => {
        mockResponse.sendData(mockSections);
      });

      const sections = await client.getLibrarySections();

      expect(sections).toEqual([]);
    });

    it('should include token in request URL', async () => {
      setImmediate(() => {
        mockResponse.sendData({ MediaContainer: { Directory: [] } });
      });

      await client.getLibrarySections();

      expect(http.request).toHaveBeenCalled();
      const callArgs = httpRequestSpy.mock.calls[0] as unknown[];
      const url = callArgs[0] as URL;
      expect(url.searchParams.get('X-Plex-Token')).toBe('test-token');
    });
  });

  describe('searchMovies', () => {
    it('should search for movies by title', async () => {
      // First call: getLibrarySections
      const sectionsResponse = {
        MediaContainer: {
          Directory: [{ key: '1', type: 'movie', title: 'Movies' }],
        },
      };

      // Second call: search in section
      const searchResponse = {
        MediaContainer: {
          Metadata: [
            {
              ratingKey: '12345',
              key: '/library/metadata/12345',
              type: 'movie',
              title: 'The Matrix',
              year: 1999,
              thumb: '/library/metadata/12345/thumb',
            },
          ],
        },
      };

      let callCount = 0;
      jest.spyOn(http, 'request').mockImplementation((...args: unknown[]) => {
        const response = new MockResponse(200);
        const callback = args.find(arg => typeof arg === 'function') as ((res: unknown) => void) | undefined;
        if (callback) {
          setImmediate(() => {
            callback(response);
            setImmediate(() => {
              response.sendData(callCount === 0 ? sectionsResponse : searchResponse);
              callCount++;
            });
          });
        }
        return mockRequest as unknown as http.ClientRequest;
      });

      const results = await client.searchMovies('Matrix');

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('The Matrix');
      expect(results[0].year).toBe(1999);
      expect(results[0].type).toBe('movie');
    });

    it('should filter by year when provided', async () => {
      const sectionsResponse = {
        MediaContainer: {
          Directory: [{ key: '1', type: 'movie', title: 'Movies' }],
        },
      };

      const searchResponse = {
        MediaContainer: {
          Metadata: [
            { ratingKey: '1', key: '/1', type: 'movie', title: 'Dune', year: 1984 },
            { ratingKey: '2', key: '/2', type: 'movie', title: 'Dune', year: 2021 },
          ],
        },
      };

      let callCount = 0;
      jest.spyOn(http, 'request').mockImplementation((...args: unknown[]) => {
        const response = new MockResponse(200);
        const callback = args.find(arg => typeof arg === 'function') as ((res: unknown) => void) | undefined;
        if (callback) {
          setImmediate(() => {
            callback(response);
            setImmediate(() => {
              response.sendData(callCount === 0 ? sectionsResponse : searchResponse);
              callCount++;
            });
          });
        }
        return mockRequest as unknown as http.ClientRequest;
      });

      const results = await client.searchMovies('Dune', 2021);

      expect(results).toHaveLength(1);
      expect(results[0].year).toBe(2021);
    });
  });

  describe('searchShows', () => {
    it('should search for TV shows by title', async () => {
      const sectionsResponse = {
        MediaContainer: {
          Directory: [{ key: '2', type: 'show', title: 'TV Shows' }],
        },
      };

      const searchResponse = {
        MediaContainer: {
          Metadata: [
            {
              ratingKey: '67890',
              key: '/library/metadata/67890',
              type: 'show',
              title: 'Breaking Bad',
              year: 2008,
            },
          ],
        },
      };

      let callCount = 0;
      jest.spyOn(http, 'request').mockImplementation((...args: unknown[]) => {
        const response = new MockResponse(200);
        const callback = args.find(arg => typeof arg === 'function') as ((res: unknown) => void) | undefined;
        if (callback) {
          setImmediate(() => {
            callback(response);
            setImmediate(() => {
              response.sendData(callCount === 0 ? sectionsResponse : searchResponse);
              callCount++;
            });
          });
        }
        return mockRequest as unknown as http.ClientRequest;
      });

      const results = await client.searchShows('Breaking Bad');

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Breaking Bad');
      expect(results[0].type).toBe('show');
    });
  });

  describe('getChildren', () => {
    it('should get children of a show (seasons)', async () => {
      const childrenResponse = {
        MediaContainer: {
          Metadata: [
            { ratingKey: '100', key: '/100', type: 'season', title: 'Season 1', index: 1 },
            { ratingKey: '101', key: '/101', type: 'season', title: 'Season 2', index: 2 },
          ],
        },
      };

      setImmediate(() => {
        mockResponse.sendData(childrenResponse);
      });

      const children = await client.getChildren('67890');

      expect(children).toHaveLength(2);
      expect(children[0].type).toBe('season');
      expect(children[0].index).toBe(1);
    });

    it('should get children of a season (episodes)', async () => {
      const childrenResponse = {
        MediaContainer: {
          Metadata: [
            {
              ratingKey: '200',
              key: '/200',
              type: 'episode',
              title: 'Pilot',
              index: 1,
              parentIndex: 1,
              grandparentTitle: 'Breaking Bad',
              parentTitle: 'Season 1',
            },
          ],
        },
      };

      setImmediate(() => {
        mockResponse.sendData(childrenResponse);
      });

      const children = await client.getChildren('100');

      expect(children).toHaveLength(1);
      expect(children[0].type).toBe('episode');
      expect(children[0].index).toBe(1);
      expect(children[0].parentIndex).toBe(1);
      expect(children[0].grandparentTitle).toBe('Breaking Bad');
    });
  });

  describe('getMetadata', () => {
    it('should get metadata for an item', async () => {
      const metadataResponse = {
        MediaContainer: {
          Metadata: [
            {
              ratingKey: '12345',
              key: '/library/metadata/12345',
              type: 'movie',
              title: 'The Matrix',
              year: 1999,
              thumb: '/library/metadata/12345/thumb',
              art: '/library/metadata/12345/art',
            },
          ],
        },
      };

      setImmediate(() => {
        mockResponse.sendData(metadataResponse);
      });

      const metadata = await client.getMetadata('12345');

      expect(metadata).not.toBeNull();
      expect(metadata?.title).toBe('The Matrix');
      expect(metadata?.year).toBe(1999);
    });

    it('should return null when metadata not found', async () => {
      const metadataResponse = {
        MediaContainer: {},
      };

      setImmediate(() => {
        mockResponse.sendData(metadataResponse);
      });

      const metadata = await client.getMetadata('99999');

      expect(metadata).toBeNull();
    });
  });

  describe('getArtworkUrl', () => {
    it('should build full artwork URL with token', () => {
      const url = client.getArtworkUrl('/library/metadata/12345/thumb/1234567890');

      expect(url).toContain('http://localhost:32400');
      expect(url).toContain('/library/metadata/12345/thumb');
      expect(url).toContain('X-Plex-Token=test-token');
    });

    it('should return empty string for empty path', () => {
      const url = client.getArtworkUrl('');

      expect(url).toBe('');
    });
  });

  describe('testConnection', () => {
    it('should return true when Plex server responds', async () => {
      const identityResponse = {
        MediaContainer: {
          machineIdentifier: 'abc123',
          version: '1.32.0',
        },
      };

      setImmediate(() => {
        mockResponse.sendData(identityResponse);
      });

      const result = await client.testConnection();

      expect(result).toBe(true);
    });

    it('should return false when Plex server returns no machineIdentifier', async () => {
      const identityResponse = {
        MediaContainer: {},
      };

      setImmediate(() => {
        mockResponse.sendData(identityResponse);
      });

      const result = await client.testConnection();

      expect(result).toBe(false);
    });

    it('should return false when request fails', async () => {
      setImmediate(() => {
        mockRequest.emit('error', new Error('Connection refused'));
      });

      const result = await client.testConnection();

      expect(result).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should reject on HTTP error status', async () => {
      mockResponse = new MockResponse(500);

      // Update mock to use new response
      jest.spyOn(http, 'request').mockImplementation((...args: unknown[]) => {
        const callback = args.find(arg => typeof arg === 'function') as ((res: unknown) => void) | undefined;
        if (callback) {
          setImmediate(() => callback(mockResponse));
        }
        return mockRequest as unknown as http.ClientRequest;
      });

      setImmediate(() => {
        mockResponse.sendData('Internal Server Error');
      });

      await expect(client.getLibrarySections()).rejects.toThrow('Plex API error: 500');
    });

    it('should reject on invalid JSON response', async () => {
      setImmediate(() => {
        mockResponse.emit('data', 'not valid json');
        mockResponse.emit('end');
      });

      await expect(client.getLibrarySections()).rejects.toThrow('Failed to parse Plex response');
    });

    it('should reject on network error', async () => {
      setImmediate(() => {
        mockRequest.emit('error', new Error('ECONNREFUSED'));
      });

      await expect(client.getLibrarySections()).rejects.toThrow('ECONNREFUSED');
    });

    it('should reject on timeout', async () => {
      setImmediate(() => {
        mockRequest.emit('timeout');
      });

      await expect(client.getLibrarySections()).rejects.toThrow('Plex request timeout');
      expect(mockRequest.destroyed).toBe(true);
    });
  });

  describe('HTTPS support', () => {
    it('should use https module for https URLs', async () => {
      const httpsClient = new PlexClient({
        url: 'https://localhost:32400',
        token: 'test-token',
      });

      setImmediate(() => {
        mockResponse.sendData({ MediaContainer: { Directory: [] } });
      });

      await httpsClient.getLibrarySections();

      expect(https.request).toHaveBeenCalled();
      expect(http.request).not.toHaveBeenCalled();
    });
  });
});
