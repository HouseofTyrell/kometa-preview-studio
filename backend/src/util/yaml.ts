import * as yaml from 'yaml';

export interface ParsedConfig {
  raw: string;
  parsed: Record<string, unknown> | null;
  error: string | null;
}

export interface PlexConfig {
  url?: string;
  token?: string;
  timeout?: number;
}

export interface LibraryConfig {
  name: string;
  overlay_files?: Array<string | Record<string, unknown>>;
  operations?: Record<string, unknown>;
  collections?: Record<string, unknown>;
}

export interface KometaConfig {
  plex?: PlexConfig;
  libraries?: Record<string, LibraryConfig>;
  settings?: Record<string, unknown>;
  webhooks?: Record<string, unknown>;
  tmdb?: Record<string, unknown>;
  tautulli?: Record<string, unknown>;
  omdb?: Record<string, unknown>;
  mdblist?: Record<string, unknown>;
  notifiarr?: Record<string, unknown>;
  anidb?: Record<string, unknown>;
  radarr?: Record<string, unknown>;
  sonarr?: Record<string, unknown>;
  trakt?: Record<string, unknown>;
  mal?: Record<string, unknown>;
}

export interface ConfigAnalysis {
  plexUrl: string | null;
  tokenPresent: boolean;
  assetDirectories: string[];
  overlayFiles: string[];
  libraryNames: string[];
  warnings: string[];
  overlayYaml: string;
}

/**
 * Parse YAML config text into structured object
 */
export function parseYaml(text: string): ParsedConfig {
  try {
    const parsed = yaml.parse(text);
    return { raw: text, parsed, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown parse error';
    return { raw: text, parsed: null, error: message };
  }
}

/**
 * Stringify object to YAML
 */
export function stringifyYaml(obj: unknown): string {
  const raw = yaml.stringify(obj, { indent: 2 });
  return stripYamlDocEndMarkers(raw);
}

function stripYamlDocEndMarkers(text: string): string {
  const lines = text.split(/\r?\n/);
  let lastNonEmpty = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim() !== '') {
      lastNonEmpty = i;
      break;
    }
  }

  const filtered = lines.filter((line, index) => {
    if (line.trim() !== '...') {
      return true;
    }
    return index === lastNonEmpty;
  });

  return filtered.join('\n');
}

/**
 * Analyze a Kometa config and extract relevant information
 */
export function analyzeConfig(config: KometaConfig): ConfigAnalysis {
  const warnings: string[] = [];
  const assetDirectories: string[] = [];
  const overlayFiles: string[] = [];
  const libraryNames: string[] = [];

  // Extract Plex URL
  const plexUrl = config.plex?.url || null;
  if (!plexUrl) {
    warnings.push('No Plex URL found in config');
  }

  // Check for token
  const tokenPresent = !!config.plex?.token;
  if (!tokenPresent) {
    warnings.push('No Plex token found in config');
  }

  // Extract asset directories from settings
  if (config.settings) {
    const settings = config.settings as Record<string, unknown>;
    if (settings.asset_directory) {
      if (Array.isArray(settings.asset_directory)) {
        assetDirectories.push(...settings.asset_directory.map(String));
      } else {
        assetDirectories.push(String(settings.asset_directory));
      }
    }
  }

  // Extract library info and overlay files
  if (config.libraries) {
    for (const [libName, libConfig] of Object.entries(config.libraries)) {
      libraryNames.push(libName);
      if (libConfig.overlay_files) {
        for (const overlayFile of libConfig.overlay_files) {
          if (typeof overlayFile === 'string') {
            overlayFiles.push(overlayFile);
          } else if (typeof overlayFile === 'object' && overlayFile !== null) {
            // Could be { pmm: ... } or { file: ... } etc.
            const keys = Object.keys(overlayFile);
            for (const key of keys) {
              const value = (overlayFile as Record<string, unknown>)[key];
              overlayFiles.push(`${key}: ${value}`);
            }
          }
        }
      }
    }
  }

  if (overlayFiles.length === 0) {
    warnings.push('No overlay_files found in any library');
  }

  // Extract overlay-related YAML sections for editing
  const overlayYaml = extractOverlayYaml(config);

  return {
    plexUrl,
    tokenPresent,
    assetDirectories,
    overlayFiles,
    libraryNames,
    warnings,
    overlayYaml,
  };
}

/**
 * Extract overlay-related sections as YAML text
 */
function extractOverlayYaml(config: KometaConfig): string {
  const overlayConfig: Record<string, unknown> = {};

  if (config.libraries) {
    const libsWithOverlays: Record<string, unknown> = {};
    for (const [libName, libConfig] of Object.entries(config.libraries)) {
      if (libConfig.overlay_files) {
        libsWithOverlays[libName] = {
          overlay_files: libConfig.overlay_files,
        };
      }
    }
    if (Object.keys(libsWithOverlays).length > 0) {
      overlayConfig.libraries = libsWithOverlays;
    }
  }

  return stringifyYaml(overlayConfig);
}

/**
 * Redact sensitive information from config for logging
 */
export function redactConfig(config: KometaConfig): KometaConfig {
  const redacted = JSON.parse(JSON.stringify(config)) as KometaConfig;
  if (redacted.plex?.token) {
    redacted.plex.token = '[REDACTED]';
  }
  if (redacted.tmdb && typeof redacted.tmdb === 'object') {
    const tmdb = redacted.tmdb as Record<string, unknown>;
    if (tmdb.apikey) tmdb.apikey = '[REDACTED]';
  }
  if (redacted.omdb && typeof redacted.omdb === 'object') {
    const omdb = redacted.omdb as Record<string, unknown>;
    if (omdb.apikey) omdb.apikey = '[REDACTED]';
  }
  if (redacted.trakt && typeof redacted.trakt === 'object') {
    const trakt = redacted.trakt as Record<string, unknown>;
    if (trakt.client_id) trakt.client_id = '[REDACTED]';
    if (trakt.client_secret) trakt.client_secret = '[REDACTED]';
  }
  return redacted;
}
