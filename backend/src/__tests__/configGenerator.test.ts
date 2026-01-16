import { generatePreviewConfig } from '../kometa/configGenerator.js';
import { KometaConfig } from '../util/yaml.js';
import { ResolvedTarget } from '../plex/resolveTargets.js';
import { FetchedArtwork } from '../plex/fetchArtwork.js';
import { DEFAULT_TEST_OPTIONS } from '../types/testOptions.js';

describe('configGenerator', () => {
  const mockConfig: KometaConfig = {
    plex: {
      url: 'http://192.168.1.100:32400',
      token: 'test-token',
      timeout: 60,
    },
    tmdb: { apikey: 'tmdb-key' },
    libraries: {
      Movies: {
        name: 'Movies',
        overlay_files: [
          { default: 'resolution' },
          { pmm: 'ratings' },
        ],
      },
    },
  };

  const mockTargets: ResolvedTarget[] = [
    {
      id: 'matrix',
      label: 'The Matrix (1999)',
      type: 'movie',
      searchTitle: 'The Matrix',
      searchYear: 1999,
      ratingKey: '12345',
      actualTitle: 'The Matrix',
      thumbPath: '/path/to/thumb.jpg',
      warnings: [],
      metadata: {
        resolution: '4K',
        imdbRating: 8.7,
      },
    },
  ];

  const mockArtwork: FetchedArtwork[] = [
    {
      targetId: 'matrix',
      source: 'plex_current',
      localPath: '/jobs/input/matrix.jpg',
      warnings: [],
    },
  ];

  const mockJobPaths = {
    inputDir: '/jobs/input',
    outputDir: '/jobs/output',
    configDir: '/jobs/config',
  };

  describe('generatePreviewConfig', () => {
    it('should generate valid config YAML', () => {
      const result = generatePreviewConfig(
        mockConfig,
        mockTargets,
        mockArtwork,
        mockJobPaths
      );

      expect(result.configYaml).toBeDefined();
      expect(result.configYaml.length).toBeGreaterThan(0);
    });

    it('should include plex configuration', () => {
      const result = generatePreviewConfig(
        mockConfig,
        mockTargets,
        mockArtwork,
        mockJobPaths
      );

      expect(result.configYaml).toContain('plex:');
      expect(result.configYaml).toContain('url: http://192.168.1.100:32400');
      expect(result.configYaml).toContain('token: test-token');
    });

    it('should include tmdb configuration', () => {
      const result = generatePreviewConfig(
        mockConfig,
        mockTargets,
        mockArtwork,
        mockJobPaths
      );

      expect(result.configYaml).toContain('tmdb:');
      expect(result.configYaml).toContain('apikey: tmdb-key');
    });

    it('should generate target mapping', () => {
      const result = generatePreviewConfig(
        mockConfig,
        mockTargets,
        mockArtwork,
        mockJobPaths
      );

      expect(result.targetMapping).toBeDefined();
      expect(result.targetMapping.matrix).toBeDefined();
      expect(result.targetMapping.matrix.inputPath).toBe('/jobs/input/matrix.jpg');
      expect(result.targetMapping.matrix.outputPath).toBe('/jobs/output/matrix_after.png');
    });

    it('should include preview section with targets', () => {
      const result = generatePreviewConfig(
        mockConfig,
        mockTargets,
        mockArtwork,
        mockJobPaths
      );

      expect(result.configYaml).toContain('preview:');
      expect(result.configYaml).toContain('mode: write_blocked');
      expect(result.configYaml).toContain('targets:');
      expect(result.configYaml).toContain('ratingKey:');
    });

    it('should include metadata in preview targets', () => {
      const result = generatePreviewConfig(
        mockConfig,
        mockTargets,
        mockArtwork,
        mockJobPaths
      );

      expect(result.configYaml).toContain('metadata:');
      expect(result.configYaml).toContain('resolution: 4K');
    });

    it('should filter overlay files by selection', () => {
      const testOptions = {
        ...DEFAULT_TEST_OPTIONS,
        selectedOverlays: ['default: resolution'],
      };

      const result = generatePreviewConfig(
        mockConfig,
        mockTargets,
        mockArtwork,
        mockJobPaths,
        testOptions
      );

      // Should include resolution but not ratings
      expect(result.configYaml).toContain('resolution');
    });

    it('should filter libraries by selection', () => {
      const configWithMultipleLibs: KometaConfig = {
        ...mockConfig,
        libraries: {
          Movies: {
            name: 'Movies',
            overlay_files: [{ default: 'resolution' }],
          },
          'TV Shows': {
            name: 'TV Shows',
            overlay_files: [{ default: 'status' }],
          },
        },
      };

      const testOptions = {
        ...DEFAULT_TEST_OPTIONS,
        selectedLibraries: ['Movies'],
      };

      const result = generatePreviewConfig(
        configWithMultipleLibs,
        mockTargets,
        mockArtwork,
        mockJobPaths,
        testOptions
      );

      expect(result.configYaml).toContain('Movies:');
      expect(result.configYaml).not.toContain('TV Shows:');
    });

    it('should set run_order to overlays only', () => {
      const result = generatePreviewConfig(
        mockConfig,
        mockTargets,
        mockArtwork,
        mockJobPaths
      );

      expect(result.configYaml).toContain('run_order:');
      expect(result.configYaml).toContain('- overlays');
    });

    it('should disable cache', () => {
      const result = generatePreviewConfig(
        mockConfig,
        mockTargets,
        mockArtwork,
        mockJobPaths
      );

      expect(result.configYaml).toContain('cache: false');
    });

    it('should enable manual mode by default', () => {
      const result = generatePreviewConfig(
        mockConfig,
        mockTargets,
        mockArtwork,
        mockJobPaths
      );

      expect(result.configYaml).toContain('manual_mode: true');
      expect(result.configYaml).toContain('manual_overlays:');
    });

    it('should disable manual mode when useFullKometaBuilder is true', () => {
      const testOptions = {
        ...DEFAULT_TEST_OPTIONS,
        useFullKometaBuilder: true,
      };

      const result = generatePreviewConfig(
        mockConfig,
        mockTargets,
        mockArtwork,
        mockJobPaths,
        testOptions
      );

      expect(result.configYaml).not.toContain('manual_mode: true');
    });
  });
});
