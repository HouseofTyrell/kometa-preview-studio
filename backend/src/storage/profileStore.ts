import * as path from 'path';
import { ensureDir, readJson, writeJson, listFiles, deleteFile, pathExists } from '../util/safeFs.js';
import { getJobsBasePath } from '../jobs/paths.js';
import { MAX_PROFILES, PROFILE_EXPIRY_MS } from '../constants.js';
import { storageLogger } from '../util/logger.js';

/**
 * Profile data structure
 */
export interface ProfileData {
  id: string;
  configYaml: string;
  analysis: {
    plexUrl: string | null;
    tokenPresent: boolean;
    assetDirectories: string[];
    overlayFiles: string[];
    libraryNames: string[];
    warnings: string[];
    overlayYaml: string;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Get the profiles directory path
 */
function getProfilesDir(): string {
  return path.join(getJobsBasePath(), 'profiles');
}

/**
 * Get the path for a specific profile
 */
function getProfilePath(profileId: string): string {
  // Sanitize profileId to prevent path traversal
  const sanitized = profileId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(getProfilesDir(), `${sanitized}.json`);
}

/**
 * Persistent Profile Store
 * Stores profiles on disk while maintaining an in-memory cache
 */
class ProfileStore {
  private cache: Map<string, ProfileData> = new Map();
  private initialized = false;

  /**
   * Initialize the store - load existing profiles from disk
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const profilesDir = getProfilesDir();
    await ensureDir(profilesDir);

    try {
      const files = await listFiles(profilesDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      for (const file of jsonFiles) {
        const filePath = path.join(profilesDir, file);
        const profile = await readJson<ProfileData>(filePath);
        if (profile && profile.id) {
          // Check if profile is expired
          const createdAt = new Date(profile.createdAt).getTime();
          const now = Date.now();
          if (now - createdAt < PROFILE_EXPIRY_MS) {
            this.cache.set(profile.id, profile);
          } else {
            // Delete expired profile
            await deleteFile(filePath);
          }
        }
      }

      storageLogger.info({ count: this.cache.size }, 'Loaded profiles from disk');
    } catch (err) {
      storageLogger.error({ err }, 'Failed to load profiles from disk');
    }

    this.initialized = true;
  }

  /**
   * Get a profile by ID
   */
  get(profileId: string): ProfileData | undefined {
    return this.cache.get(profileId);
  }

  /**
   * Check if a profile exists
   */
  has(profileId: string): boolean {
    return this.cache.has(profileId);
  }

  /**
   * Save a profile
   */
  async set(profileId: string, profile: ProfileData): Promise<void> {
    // Enforce max profiles limit
    if (!this.cache.has(profileId) && this.cache.size >= MAX_PROFILES) {
      // Remove oldest profile
      const oldest = this.getOldestProfile();
      if (oldest) {
        await this.delete(oldest.id);
      }
    }

    this.cache.set(profileId, profile);

    // Persist to disk
    try {
      const profilePath = getProfilePath(profileId);
      await writeJson(profilePath, profile);
    } catch (err) {
      storageLogger.error({ err, profileId }, 'Failed to save profile');
    }
  }

  /**
   * Delete a profile
   */
  async delete(profileId: string): Promise<boolean> {
    const existed = this.cache.delete(profileId);

    // Remove from disk
    try {
      const profilePath = getProfilePath(profileId);
      if (await pathExists(profilePath)) {
        await deleteFile(profilePath);
      }
    } catch (err) {
      storageLogger.error({ err, profileId }, 'Failed to delete profile');
    }

    return existed;
  }

  /**
   * Get all profiles
   */
  values(): IterableIterator<ProfileData> {
    return this.cache.values();
  }

  /**
   * Get profile count
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get the oldest profile (for eviction)
   */
  private getOldestProfile(): ProfileData | undefined {
    let oldest: ProfileData | undefined;
    let oldestTime = Infinity;

    for (const profile of this.cache.values()) {
      const createdAt = new Date(profile.createdAt).getTime();
      if (createdAt < oldestTime) {
        oldestTime = createdAt;
        oldest = profile;
      }
    }

    return oldest;
  }
}

// Singleton instance
let storeInstance: ProfileStore | null = null;

/**
 * Get the singleton profile store instance
 */
export function getProfileStore(): ProfileStore {
  if (!storeInstance) {
    storeInstance = new ProfileStore();
  }
  return storeInstance;
}

/**
 * Initialize the profile store (call during app startup)
 */
export async function initializeProfileStore(): Promise<void> {
  const store = getProfileStore();
  await store.initialize();
}
