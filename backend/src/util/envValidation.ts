import { serverLogger } from './logger.js';

interface EnvValidationError {
  variable: string;
  message: string;
  severity: 'error' | 'warning';
}

interface EnvValidationResult {
  valid: boolean;
  errors: EnvValidationError[];
  warnings: EnvValidationError[];
}

/**
 * Validate that a string is a valid positive integer
 */
function isValidPort(value: string): boolean {
  const num = parseInt(value, 10);
  return !isNaN(num) && num > 0 && num <= 65535;
}

/**
 * Validate that a string is a valid URL
 */
function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate that a string looks like a valid path (basic check)
 */
function isValidPath(value: string): boolean {
  // Basic path validation - must not be empty and should look like a path
  return value.length > 0 && !value.includes('\0');
}

/**
 * Validate that a Docker image tag is reasonable
 */
function isValidDockerImage(value: string): boolean {
  // Basic validation: not empty, no spaces, reasonable format
  return value.length > 0 && !value.includes(' ') && value.length < 256;
}

/**
 * Validate all environment variables at startup.
 *
 * This function checks environment variables for:
 * - Required values that have no sensible defaults
 * - Correct formats (ports, URLs, paths)
 * - Common misconfigurations
 *
 * Returns validation result with errors and warnings.
 * Errors should cause startup to fail; warnings are informational.
 */
export function validateEnvironment(): EnvValidationResult {
  const errors: EnvValidationError[] = [];
  const warnings: EnvValidationError[] = [];

  // ========================================
  // Server Configuration
  // ========================================

  // PORT - optional, has default
  if (process.env.PORT !== undefined) {
    if (!isValidPort(process.env.PORT)) {
      errors.push({
        variable: 'PORT',
        message: `Invalid port number: "${process.env.PORT}". Must be a number between 1 and 65535.`,
        severity: 'error',
      });
    }
  }

  // HOST - optional, has default
  if (process.env.HOST !== undefined) {
    const host = process.env.HOST;
    // Basic validation - should be an IP or hostname
    if (host.length === 0) {
      errors.push({
        variable: 'HOST',
        message: 'HOST cannot be empty if specified.',
        severity: 'error',
      });
    }
  }

  // CORS_ORIGIN - optional, has default
  if (process.env.CORS_ORIGIN !== undefined) {
    if (!isValidUrl(process.env.CORS_ORIGIN)) {
      errors.push({
        variable: 'CORS_ORIGIN',
        message: `Invalid URL for CORS_ORIGIN: "${process.env.CORS_ORIGIN}". Must be a valid URL.`,
        severity: 'error',
      });
    }
  }

  // ========================================
  // Path Configuration
  // ========================================

  // JOBS_PATH - optional, has default
  if (process.env.JOBS_PATH !== undefined) {
    if (!isValidPath(process.env.JOBS_PATH)) {
      errors.push({
        variable: 'JOBS_PATH',
        message: `Invalid path for JOBS_PATH: "${process.env.JOBS_PATH}".`,
        severity: 'error',
      });
    }
  }

  // JOBS_HOST_PATH - important for Docker mode
  if (process.env.JOBS_HOST_PATH !== undefined) {
    if (!isValidPath(process.env.JOBS_HOST_PATH)) {
      errors.push({
        variable: 'JOBS_HOST_PATH',
        message: `Invalid path for JOBS_HOST_PATH: "${process.env.JOBS_HOST_PATH}".`,
        severity: 'error',
      });
    }
  } else if (isRunningInDocker()) {
    warnings.push({
      variable: 'JOBS_HOST_PATH',
      message: 'JOBS_HOST_PATH not set. Docker volume mounts may not work correctly for preview jobs.',
      severity: 'warning',
    });
  }

  // FONTS_PATH - optional, has default
  if (process.env.FONTS_PATH !== undefined) {
    if (!isValidPath(process.env.FONTS_PATH)) {
      errors.push({
        variable: 'FONTS_PATH',
        message: `Invalid path for FONTS_PATH: "${process.env.FONTS_PATH}".`,
        severity: 'error',
      });
    }
  }

  // FONTS_HOST_PATH - important for Docker mode
  if (process.env.FONTS_HOST_PATH !== undefined) {
    if (!isValidPath(process.env.FONTS_HOST_PATH)) {
      errors.push({
        variable: 'FONTS_HOST_PATH',
        message: `Invalid path for FONTS_HOST_PATH: "${process.env.FONTS_HOST_PATH}".`,
        severity: 'error',
      });
    }
  }

  // ========================================
  // Docker Configuration
  // ========================================

  // KOMETA_IMAGE_TAG - optional, has default
  if (process.env.KOMETA_IMAGE_TAG !== undefined) {
    if (!isValidDockerImage(process.env.KOMETA_IMAGE_TAG)) {
      errors.push({
        variable: 'KOMETA_IMAGE_TAG',
        message: `Invalid Docker image tag: "${process.env.KOMETA_IMAGE_TAG}".`,
        severity: 'error',
      });
    }
  }

  // KOMETA_RENDERER_IMAGE - optional, has default
  if (process.env.KOMETA_RENDERER_IMAGE !== undefined) {
    if (!isValidDockerImage(process.env.KOMETA_RENDERER_IMAGE)) {
      errors.push({
        variable: 'KOMETA_RENDERER_IMAGE',
        message: `Invalid Docker image name: "${process.env.KOMETA_RENDERER_IMAGE}".`,
        severity: 'error',
      });
    }
  }

  // ========================================
  // Optional Paths
  // ========================================

  if (process.env.USER_ASSETS_PATH !== undefined) {
    if (!isValidPath(process.env.USER_ASSETS_PATH)) {
      warnings.push({
        variable: 'USER_ASSETS_PATH',
        message: `Invalid path for USER_ASSETS_PATH: "${process.env.USER_ASSETS_PATH}".`,
        severity: 'warning',
      });
    }
  }

  if (process.env.USER_KOMETA_CONFIG_PATH !== undefined) {
    if (!isValidPath(process.env.USER_KOMETA_CONFIG_PATH)) {
      warnings.push({
        variable: 'USER_KOMETA_CONFIG_PATH',
        message: `Invalid path for USER_KOMETA_CONFIG_PATH: "${process.env.USER_KOMETA_CONFIG_PATH}".`,
        severity: 'warning',
      });
    }
  }

  if (process.env.CACHE_HOST_PATH !== undefined) {
    if (!isValidPath(process.env.CACHE_HOST_PATH)) {
      warnings.push({
        variable: 'CACHE_HOST_PATH',
        message: `Invalid path for CACHE_HOST_PATH: "${process.env.CACHE_HOST_PATH}".`,
        severity: 'warning',
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Simple heuristic to detect if running inside a Docker container
 */
function isRunningInDocker(): boolean {
  // Check for /.dockerenv file (common Docker indicator)
  // or check cgroup for docker/kubepods
  try {
    const fs = require('fs');
    if (fs.existsSync('/.dockerenv')) {
      return true;
    }
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
    return cgroup.includes('docker') || cgroup.includes('kubepods');
  } catch {
    return false;
  }
}

/**
 * Run environment validation and log results.
 * Throws an error if validation fails (errors found).
 */
export function validateEnvironmentOrExit(): void {
  const result = validateEnvironment();

  // Log warnings
  for (const warning of result.warnings) {
    serverLogger.warn({ variable: warning.variable }, warning.message);
  }

  // Log errors and exit if any
  if (!result.valid) {
    serverLogger.error('Environment validation failed:');
    for (const error of result.errors) {
      serverLogger.error({ variable: error.variable }, `  ${error.message}`);
    }
    serverLogger.error('Please fix the environment configuration and restart.');
    process.exit(1);
  }

  if (result.warnings.length > 0) {
    serverLogger.info(`Environment validated with ${result.warnings.length} warning(s).`);
  } else {
    serverLogger.info('Environment validated successfully.');
  }
}

/**
 * Log current environment configuration (for debugging)
 */
export function logEnvironmentConfig(): void {
  serverLogger.debug('Environment Configuration:');
  serverLogger.debug({ PORT: process.env.PORT || '(default: 3001)' }, '  PORT');
  serverLogger.debug({ HOST: process.env.HOST || '(default: 127.0.0.1)' }, '  HOST');
  serverLogger.debug({ CORS_ORIGIN: process.env.CORS_ORIGIN || '(default: http://localhost:5173)' }, '  CORS_ORIGIN');
  serverLogger.debug({ JOBS_PATH: process.env.JOBS_PATH || '(default: ./jobs)' }, '  JOBS_PATH');
  serverLogger.debug({ JOBS_HOST_PATH: process.env.JOBS_HOST_PATH || '(not set)' }, '  JOBS_HOST_PATH');
  serverLogger.debug({ FONTS_PATH: process.env.FONTS_PATH || '(default: ./fonts)' }, '  FONTS_PATH');
  serverLogger.debug({ KOMETA_IMAGE_TAG: process.env.KOMETA_IMAGE_TAG || '(default: v2.2.2)' }, '  KOMETA_IMAGE_TAG');
  serverLogger.debug({ KOMETA_RENDERER_IMAGE: process.env.KOMETA_RENDERER_IMAGE || '(default: kometa-preview-renderer:latest)' }, '  KOMETA_RENDERER_IMAGE');
}
