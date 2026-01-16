import { filterTargets, getAvailableTargets, PREVIEW_TARGETS, PreviewTarget } from '../plex/resolveTargets.js';
import { TestOptions, DEFAULT_TEST_OPTIONS } from '../types/testOptions.js';

describe('resolveTargets utilities', () => {
  describe('PREVIEW_TARGETS', () => {
    it('should have 5 preview targets', () => {
      expect(PREVIEW_TARGETS.length).toBe(5);
    });

    it('should include both movies', () => {
      const movies = PREVIEW_TARGETS.filter(t => t.type === 'movie');
      expect(movies.length).toBe(2);
      expect(movies.map(m => m.id)).toContain('matrix');
      expect(movies.map(m => m.id)).toContain('dune');
    });

    it('should include show, season, and episode', () => {
      const show = PREVIEW_TARGETS.find(t => t.type === 'show');
      const season = PREVIEW_TARGETS.find(t => t.type === 'season');
      const episode = PREVIEW_TARGETS.find(t => t.type === 'episode');

      expect(show?.id).toBe('breakingbad_series');
      expect(season?.id).toBe('breakingbad_s01');
      expect(episode?.id).toBe('breakingbad_s01e01');
    });

    it('should have metadata on all targets', () => {
      for (const target of PREVIEW_TARGETS) {
        expect(target.metadata).toBeDefined();
        expect(target.metadata?.resolution).toBeDefined();
      }
    });

    it('should have searchTitle on all targets', () => {
      for (const target of PREVIEW_TARGETS) {
        expect(target.searchTitle).toBeDefined();
        expect(target.searchTitle.length).toBeGreaterThan(0);
      }
    });
  });

  describe('filterTargets', () => {
    it('should return all targets when no options provided', () => {
      const result = filterTargets(PREVIEW_TARGETS);
      expect(result).toEqual(PREVIEW_TARGETS);
    });

    it('should return all targets with default options', () => {
      const result = filterTargets(PREVIEW_TARGETS, DEFAULT_TEST_OPTIONS);
      expect(result.length).toBe(5);
    });

    it('should filter by selected target IDs', () => {
      const options: TestOptions = {
        ...DEFAULT_TEST_OPTIONS,
        selectedTargets: ['matrix', 'dune'],
      };
      const result = filterTargets(PREVIEW_TARGETS, options);
      expect(result.length).toBe(2);
      expect(result.map(t => t.id)).toEqual(['matrix', 'dune']);
    });

    it('should filter by media types - movies only', () => {
      const options: TestOptions = {
        ...DEFAULT_TEST_OPTIONS,
        mediaTypes: {
          movies: true,
          shows: false,
          seasons: false,
          episodes: false,
        },
      };
      const result = filterTargets(PREVIEW_TARGETS, options);
      expect(result.length).toBe(2);
      expect(result.every(t => t.type === 'movie')).toBe(true);
    });

    it('should filter by media types - shows only', () => {
      const options: TestOptions = {
        ...DEFAULT_TEST_OPTIONS,
        mediaTypes: {
          movies: false,
          shows: true,
          seasons: false,
          episodes: false,
        },
      };
      const result = filterTargets(PREVIEW_TARGETS, options);
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('show');
    });

    it('should combine selectedTargets and mediaTypes filters', () => {
      const options: TestOptions = {
        ...DEFAULT_TEST_OPTIONS,
        selectedTargets: ['matrix', 'breakingbad_series'],
        mediaTypes: {
          movies: true,
          shows: false,
          seasons: false,
          episodes: false,
        },
      };
      const result = filterTargets(PREVIEW_TARGETS, options);
      // First filter by selectedTargets: matrix, breakingbad_series
      // Then filter by mediaTypes: only movies
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('matrix');
    });

    it('should return empty array when no targets match', () => {
      const options: TestOptions = {
        ...DEFAULT_TEST_OPTIONS,
        selectedTargets: ['nonexistent'],
      };
      const result = filterTargets(PREVIEW_TARGETS, options);
      expect(result.length).toBe(0);
    });

    it('should return empty when all media types are disabled', () => {
      const options: TestOptions = {
        ...DEFAULT_TEST_OPTIONS,
        mediaTypes: {
          movies: false,
          shows: false,
          seasons: false,
          episodes: false,
        },
      };
      const result = filterTargets(PREVIEW_TARGETS, options);
      expect(result.length).toBe(0);
    });
  });

  describe('getAvailableTargets', () => {
    it('should return simplified target info', () => {
      const targets = getAvailableTargets();
      expect(targets.length).toBe(5);

      for (const target of targets) {
        expect(target).toHaveProperty('id');
        expect(target).toHaveProperty('label');
        expect(target).toHaveProperty('type');
        // Should NOT have metadata or searchTitle (those are internal)
        expect(target).not.toHaveProperty('metadata');
        expect(target).not.toHaveProperty('searchTitle');
      }
    });

    it('should match PREVIEW_TARGETS ids', () => {
      const targets = getAvailableTargets();
      const ids = targets.map(t => t.id);
      const expectedIds = PREVIEW_TARGETS.map(t => t.id);
      expect(ids).toEqual(expectedIds);
    });
  });
});
