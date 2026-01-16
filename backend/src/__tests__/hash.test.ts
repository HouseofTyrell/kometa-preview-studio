import { shortHash, generateJobId, generateProfileId } from '../util/hash.js';

describe('hash utilities', () => {
  describe('shortHash', () => {
    it('should generate consistent hash for same input', () => {
      const input = 'test content';
      const hash1 = shortHash(input);
      const hash2 = shortHash(input);
      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different inputs', () => {
      const hash1 = shortHash('content1');
      const hash2 = shortHash('content2');
      expect(hash1).not.toBe(hash2);
    });

    it('should default to 8 characters', () => {
      const hash = shortHash('test');
      expect(hash.length).toBe(8);
    });

    it('should respect custom length parameter', () => {
      const hash4 = shortHash('test', 4);
      const hash16 = shortHash('test', 16);
      expect(hash4.length).toBe(4);
      expect(hash16.length).toBe(16);
    });

    it('should only contain hex characters', () => {
      const hash = shortHash('test content');
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('generateJobId', () => {
    it('should start with job_ prefix', () => {
      const id = generateJobId();
      expect(id.startsWith('job_')).toBe(true);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateJobId());
      }
      expect(ids.size).toBe(100);
    });

    it('should contain timestamp component', () => {
      const before = Date.now().toString(36);
      const id = generateJobId();
      // Extract timestamp part (between job_ and second underscore)
      const parts = id.split('_');
      expect(parts.length).toBe(3);
      // Timestamp should be roughly close to current time
      const timestamp = parseInt(parts[1], 36);
      expect(timestamp).toBeGreaterThan(0);
    });
  });

  describe('generateProfileId', () => {
    it('should start with profile_ prefix', () => {
      const id = generateProfileId();
      expect(id.startsWith('profile_')).toBe(true);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateProfileId());
      }
      expect(ids.size).toBe(100);
    });

    it('should have shorter random component than job IDs', () => {
      const jobId = generateJobId();
      const profileId = generateProfileId();
      // Profile IDs have 4-char random, job IDs have 6-char random
      // Extract random parts: last segment after final underscore
      const jobRandom = jobId.split('_').pop()!;
      const profileRandom = profileId.split('_').pop()!;
      expect(profileRandom.length).toBeLessThan(jobRandom.length);
    });
  });
});
