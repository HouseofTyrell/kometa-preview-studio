import * as fs from 'fs/promises';
import * as path from 'path';
import { PlexClient } from './plexClient.js';
import { ResolvedTarget } from './resolveTargets.js';
import { pathExists } from '../util/safeFs.js';

export type ArtworkSource = 'asset_directory' | 'original_poster' | 'plex_current';

export interface FetchedArtwork {
  targetId: string;
  source: ArtworkSource;
  localPath: string;
  warnings: string[];
}

export interface ArtworkFetchOptions {
  assetDirectories: string[];
  originalPostersDir: string | null;
  inputDir: string;
}

/**
 * Fetch base artwork for all resolved targets
 */
export async function fetchArtwork(
  client: PlexClient,
  targets: ResolvedTarget[],
  options: ArtworkFetchOptions
): Promise<FetchedArtwork[]> {
  const results: FetchedArtwork[] = [];

  for (const target of targets) {
    const result = await fetchTargetArtwork(client, target, options);
    results.push(result);
  }

  return results;
}

/**
 * Fetch base artwork for a single target
 */
async function fetchTargetArtwork(
  client: PlexClient,
  target: ResolvedTarget,
  options: ArtworkFetchOptions
): Promise<FetchedArtwork> {
  const warnings: string[] = [...target.warnings];
  const outputFileName = getArtworkFileName(target);
  const localPath = path.join(options.inputDir, outputFileName);

  // Try sources in order of preference

  // 1. Asset directory
  const assetPath = await findAssetDirectoryImage(target, options.assetDirectories);
  if (assetPath) {
    await fs.copyFile(assetPath, localPath);
    return {
      targetId: target.id,
      source: 'asset_directory',
      localPath,
      warnings,
    };
  }

  // 2. Original Posters backup
  if (options.originalPostersDir) {
    const originalPath = await findOriginalPoster(target, options.originalPostersDir);
    if (originalPath) {
      await fs.copyFile(originalPath, localPath);
      return {
        targetId: target.id,
        source: 'original_poster',
        localPath,
        warnings,
      };
    }
  }

  // 3. Fallback to Plex current artwork
  if (target.thumbPath) {
    warnings.push(
      `Using Plex current artwork for ${target.label}. This may already contain overlays.`
    );
    const imageBuffer = await client.downloadArtwork(target.thumbPath);
    await fs.writeFile(localPath, imageBuffer);
    return {
      targetId: target.id,
      source: 'plex_current',
      localPath,
      warnings,
    };
  }

  // No artwork available
  warnings.push(`No artwork available for ${target.label}`);
  return {
    targetId: target.id,
    source: 'plex_current',
    localPath: '',
    warnings,
  };
}

/**
 * Get output filename for a target
 */
function getArtworkFileName(target: ResolvedTarget): string {
  return `${target.id}.jpg`;
}

/**
 * Find image in asset directories
 */
async function findAssetDirectoryImage(
  target: ResolvedTarget,
  assetDirectories: string[]
): Promise<string | null> {
  // Asset directory naming conventions by type
  const possibleNames = getAssetFileNames(target);

  for (const assetDir of assetDirectories) {
    for (const name of possibleNames) {
      const possibleExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
      for (const ext of possibleExtensions) {
        const filePath = path.join(assetDir, name + ext);
        if (await pathExists(filePath)) {
          return filePath;
        }
      }
    }
  }

  return null;
}

/**
 * Find original poster backup
 */
async function findOriginalPoster(
  target: ResolvedTarget,
  originalPostersDir: string
): Promise<string | null> {
  // Original Posters naming: typically uses the item's title/name
  const possibleNames = getAssetFileNames(target);

  for (const name of possibleNames) {
    const possibleExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    for (const ext of possibleExtensions) {
      const filePath = path.join(originalPostersDir, name + ext);
      if (await pathExists(filePath)) {
        return filePath;
      }
      // Also check in subfolders based on type
      const subfolder = getOriginalPosterSubfolder(target);
      if (subfolder) {
        const subPath = path.join(originalPostersDir, subfolder, name + ext);
        if (await pathExists(subPath)) {
          return subPath;
        }
      }
    }
  }

  return null;
}

/**
 * Get possible asset file names for a target
 */
function getAssetFileNames(target: ResolvedTarget): string[] {
  const names: string[] = [];
  const sanitizedTitle = sanitizeFileName(target.actualTitle);

  switch (target.type) {
    case 'movie':
      // Movies: "Title (Year)" or just "Title"
      names.push(sanitizedTitle);
      if (target.searchYear) {
        names.push(`${sanitizeFileName(target.searchTitle)} (${target.searchYear})`);
      }
      names.push(sanitizeFileName(target.searchTitle));
      names.push('poster');
      break;

    case 'show':
      // Shows: "Show Name" or "Show Name/poster"
      names.push(sanitizedTitle);
      names.push(sanitizeFileName(target.searchTitle));
      names.push('poster');
      break;

    case 'season':
      // Seasons: "Season01", "Season 1", etc.
      if (target.seasonIndex !== undefined) {
        names.push(`Season${String(target.seasonIndex).padStart(2, '0')}`);
        names.push(`Season ${target.seasonIndex}`);
        names.push(`season${String(target.seasonIndex).padStart(2, '0')}`);
        names.push(`season${target.seasonIndex}`);
      }
      break;

    case 'episode':
      // Episodes: "S01E01", "Episode01", etc.
      if (target.seasonIndex !== undefined && target.episodeIndex !== undefined) {
        const s = String(target.seasonIndex).padStart(2, '0');
        const e = String(target.episodeIndex).padStart(2, '0');
        names.push(`S${s}E${e}`);
        names.push(`s${s}e${e}`);
        names.push(`Episode${e}`);
      }
      break;
  }

  return names;
}

/**
 * Get subfolder for original posters based on target type
 */
function getOriginalPosterSubfolder(target: ResolvedTarget): string | null {
  switch (target.type) {
    case 'movie':
      return 'Movies';
    case 'show':
      return 'TV Shows';
    case 'season':
      return 'TV Shows';
    case 'episode':
      return 'TV Shows';
    default:
      return null;
  }
}

/**
 * Sanitize filename
 */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
