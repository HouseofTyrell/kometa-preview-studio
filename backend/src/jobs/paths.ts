import * as path from 'path';

/**
 * Get the base path for jobs directory (inside container)
 */
export function getJobsBasePath(): string {
  return process.env.JOBS_PATH || path.resolve(__dirname, '../../../jobs');
}

/**
 * Get the HOST path for jobs directory (for Docker volume mounts)
 * When running in Docker, we need the host path to create bind mounts for child containers.
 */
export function getJobsHostPath(): string {
  // JOBS_HOST_PATH should be set to the absolute host path of the jobs directory
  // This is needed because Docker bind mounts require host paths, not container paths
  return process.env.JOBS_HOST_PATH || process.env.JOBS_PATH || path.resolve(__dirname, '../../../jobs');
}

/**
 * Get the fonts directory path (inside container)
 */
export function getFontsPath(): string {
  return process.env.FONTS_PATH || path.resolve(__dirname, '../../../fonts');
}

/**
 * Get the HOST path for fonts directory (for Docker volume mounts)
 */
export function getFontsHostPath(): string {
  return process.env.FONTS_HOST_PATH || process.env.FONTS_PATH || path.resolve(__dirname, '../../../fonts');
}

/**
 * Get paths for a specific job
 */
export function getJobPaths(jobId: string): {
  jobDir: string;
  inputDir: string;
  outputDir: string;
  configDir: string;
  logsDir: string;
  metaFile: string;
} {
  const jobDir = path.join(getJobsBasePath(), jobId);
  return {
    jobDir,
    inputDir: path.join(jobDir, 'input'),
    outputDir: path.join(jobDir, 'output'),
    configDir: path.join(jobDir, 'config'),
    logsDir: path.join(jobDir, 'logs'),
    metaFile: path.join(jobDir, 'meta.json'),
  };
}

/**
 * Get the Kometa renderer Docker image name
 */
export function getKometaRendererImage(): string {
  return process.env.KOMETA_RENDERER_IMAGE || 'kometa-preview-renderer:latest';
}

/**
 * Get the Kometa image tag
 */
export function getKometaImageTag(): string {
  return process.env.KOMETA_IMAGE_TAG || 'v2.0.2';
}

/**
 * Get optional user paths
 */
export function getUserPaths(): {
  userAssetsPath: string | undefined;
  userKometaConfigPath: string | undefined;
} {
  return {
    userAssetsPath: process.env.USER_ASSETS_PATH,
    userKometaConfigPath: process.env.USER_KOMETA_CONFIG_PATH,
  };
}

/**
 * Get the HOST path for Kometa cache directory (for Docker volume mounts)
 * This caches TMDb Discover results and other external API data between preview runs
 */
export function getCacheHostPath(): string | undefined {
  return process.env.CACHE_HOST_PATH;
}
