import { parseYaml, analyzeConfig, stringifyYaml, redactConfig, KometaConfig } from '../util/yaml.js';

describe('yaml utilities', () => {
  describe('parseYaml', () => {
    it('should parse valid YAML', () => {
      const yaml = `
plex:
  url: http://localhost:32400
  token: abc123
`;
      const result = parseYaml(yaml);
      expect(result.error).toBeNull();
      expect(result.parsed).toEqual({
        plex: {
          url: 'http://localhost:32400',
          token: 'abc123',
        },
      });
    });

    it('should return error for invalid YAML', () => {
      const yaml = `
invalid:
  - unclosed: [bracket
`;
      const result = parseYaml(yaml);
      expect(result.error).not.toBeNull();
      expect(result.parsed).toBeNull();
    });

    it('should preserve raw input', () => {
      const yaml = 'key: value';
      const result = parseYaml(yaml);
      expect(result.raw).toBe(yaml);
    });

    it('should handle empty input', () => {
      const result = parseYaml('');
      expect(result.error).toBeNull();
      expect(result.parsed).toBeNull();
    });
  });

  describe('analyzeConfig', () => {
    it('should extract plex URL', () => {
      const config: KometaConfig = {
        plex: {
          url: 'http://192.168.1.100:32400',
          token: 'mytoken',
        },
      };
      const analysis = analyzeConfig(config);
      expect(analysis.plexUrl).toBe('http://192.168.1.100:32400');
      expect(analysis.tokenPresent).toBe(true);
    });

    it('should warn when plex URL is missing', () => {
      const config: KometaConfig = {
        plex: {
          token: 'mytoken',
        },
      };
      const analysis = analyzeConfig(config);
      expect(analysis.plexUrl).toBeNull();
      expect(analysis.warnings).toContain('No Plex URL found in config');
    });

    it('should warn when plex token is missing', () => {
      const config: KometaConfig = {
        plex: {
          url: 'http://localhost:32400',
        },
      };
      const analysis = analyzeConfig(config);
      expect(analysis.tokenPresent).toBe(false);
      expect(analysis.warnings).toContain('No Plex token found in config');
    });

    it('should extract library names', () => {
      const config: KometaConfig = {
        plex: { url: 'http://localhost:32400', token: 'abc' },
        libraries: {
          Movies: { name: 'Movies', overlay_files: [{ default: 'resolution' }] },
          'TV Shows': { name: 'TV Shows', overlay_files: [{ default: 'status' }] },
        },
      };
      const analysis = analyzeConfig(config);
      expect(analysis.libraryNames).toEqual(['Movies', 'TV Shows']);
    });

    it('should extract overlay files', () => {
      const config: KometaConfig = {
        plex: { url: 'http://localhost:32400', token: 'abc' },
        libraries: {
          Movies: {
            name: 'Movies',
            overlay_files: [
              { default: 'resolution' },
              { pmm: 'ratings' },
              'config/custom-overlay.yml',
            ],
          },
        },
      };
      const analysis = analyzeConfig(config);
      expect(analysis.overlayFiles).toContain('default: resolution');
      expect(analysis.overlayFiles).toContain('pmm: ratings');
      expect(analysis.overlayFiles).toContain('config/custom-overlay.yml');
    });

    it('should warn when no overlay files found', () => {
      const config: KometaConfig = {
        plex: { url: 'http://localhost:32400', token: 'abc' },
        libraries: {
          Movies: { name: 'Movies' },
        },
      };
      const analysis = analyzeConfig(config);
      expect(analysis.warnings).toContain('No overlay_files found in any library');
    });

    it('should extract asset directories', () => {
      const config: KometaConfig = {
        plex: { url: 'http://localhost:32400', token: 'abc' },
        settings: {
          asset_directory: ['/config/assets', '/media/posters'],
        },
      };
      const analysis = analyzeConfig(config);
      expect(analysis.assetDirectories).toEqual(['/config/assets', '/media/posters']);
    });

    it('should handle single asset directory', () => {
      const config: KometaConfig = {
        plex: { url: 'http://localhost:32400', token: 'abc' },
        settings: {
          asset_directory: '/config/assets',
        },
      };
      const analysis = analyzeConfig(config);
      expect(analysis.assetDirectories).toEqual(['/config/assets']);
    });
  });

  describe('stringifyYaml', () => {
    it('should convert object to YAML string', () => {
      const obj = { key: 'value', nested: { a: 1 } };
      const yaml = stringifyYaml(obj);
      expect(yaml).toContain('key: value');
      expect(yaml).toContain('nested:');
      expect(yaml).toContain('a: 1');
    });

    it('should strip YAML document end markers', () => {
      const obj = { key: 'value' };
      const yaml = stringifyYaml(obj);
      // Should not contain standalone '...' markers
      expect(yaml.split('\n').filter(l => l.trim() === '...').length).toBe(0);
    });
  });

  describe('redactConfig', () => {
    it('should redact plex token', () => {
      const config: KometaConfig = {
        plex: {
          url: 'http://localhost:32400',
          token: 'super-secret-token',
        },
      };
      const redacted = redactConfig(config);
      expect(redacted.plex?.token).toBe('[REDACTED]');
      expect(redacted.plex?.url).toBe('http://localhost:32400');
    });

    it('should redact tmdb apikey', () => {
      const config: KometaConfig = {
        plex: { url: 'http://localhost:32400', token: 'abc' },
        tmdb: { apikey: 'tmdb-secret-key' },
      };
      const redacted = redactConfig(config);
      expect((redacted.tmdb as Record<string, unknown>).apikey).toBe('[REDACTED]');
    });

    it('should redact trakt credentials', () => {
      const config: KometaConfig = {
        plex: { url: 'http://localhost:32400', token: 'abc' },
        trakt: {
          client_id: 'trakt-id',
          client_secret: 'trakt-secret',
        },
      };
      const redacted = redactConfig(config);
      expect((redacted.trakt as Record<string, unknown>).client_id).toBe('[REDACTED]');
      expect((redacted.trakt as Record<string, unknown>).client_secret).toBe('[REDACTED]');
    });

    it('should not modify original config', () => {
      const config: KometaConfig = {
        plex: {
          url: 'http://localhost:32400',
          token: 'original-token',
        },
      };
      const redacted = redactConfig(config);
      expect(config.plex?.token).toBe('original-token');
      expect(redacted.plex?.token).toBe('[REDACTED]');
    });
  });
});
