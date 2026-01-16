/**
 * Generates Kometa overlay YAML from overlay configurations
 */

import { OverlayConfig, QueueConfig } from '../types/overlayConfig'

interface GeneratedOverlayYaml {
  overlays: Record<string, OverlayDefinition>
  queues?: Record<string, QueueDefinition>
}

interface OverlayDefinition {
  overlay: OverlayAttributes
  pmm?: string
  file?: string
  url?: string
  plex_all?: boolean
}

interface OverlayAttributes {
  name: string
  group?: string
  weight?: number
  queue?: string
  suppress_overlays?: string[]
  horizontal_offset?: number
  horizontal_align?: string
  vertical_offset?: number
  vertical_align?: string
  back_color?: string
  back_width?: number
  back_height?: number
  back_radius?: number
  back_padding?: number
  back_line_color?: string
  back_line_width?: number
  font?: string
  font_size?: number
  font_color?: string
  font_style?: string
  stroke_color?: string
  stroke_width?: number
}

interface QueueDefinition {
  horizontal_align?: string
  horizontal_offset?: number
  vertical_align?: string
  vertical_offset?: number
  horizontal_spacing?: number
  vertical_spacing?: number
}

/**
 * Generate overlay attributes from config
 */
function generateOverlayAttributes(config: OverlayConfig): OverlayAttributes {
  const attrs: OverlayAttributes = {
    name: config.name,
  }

  // Position
  attrs.horizontal_align = config.position.horizontalAlign
  attrs.vertical_align = config.position.verticalAlign
  attrs.horizontal_offset = config.position.horizontalOffset
  attrs.vertical_offset = config.position.verticalOffset

  // Grouping
  if (config.grouping.group) {
    attrs.group = config.grouping.group
  }
  if (config.grouping.weight !== 100) {
    attrs.weight = config.grouping.weight
  }
  if (config.grouping.queue) {
    attrs.queue = config.grouping.queue
  }
  if (config.grouping.suppressOverlays && config.grouping.suppressOverlays.length > 0) {
    attrs.suppress_overlays = config.grouping.suppressOverlays
  }

  // Backdrop
  if (config.backdrop.enabled) {
    attrs.back_color = `"${config.backdrop.color}"`
    if (config.backdrop.width) {
      attrs.back_width = config.backdrop.width
    }
    if (config.backdrop.height) {
      attrs.back_height = config.backdrop.height
    }
    if (config.backdrop.radius) {
      attrs.back_radius = config.backdrop.radius
    }
    if (config.backdrop.padding) {
      attrs.back_padding = config.backdrop.padding
    }
    if (config.backdrop.lineColor) {
      attrs.back_line_color = `"${config.backdrop.lineColor}"`
    }
    if (config.backdrop.lineWidth) {
      attrs.back_line_width = config.backdrop.lineWidth
    }
  }

  // Text overlay attributes
  if (config.sourceType === 'text' && config.text) {
    attrs.name = `text(${config.text.content})`
    if (config.text.font) {
      attrs.font = config.text.font
    }
    if (config.text.fontSize) {
      attrs.font_size = config.text.fontSize
    }
    if (config.text.fontColor) {
      attrs.font_color = `"${config.text.fontColor}"`
    }
    if (config.text.fontStyle) {
      attrs.font_style = config.text.fontStyle
    }
    if (config.text.strokeColor) {
      attrs.stroke_color = `"${config.text.strokeColor}"`
    }
    if (config.text.strokeWidth) {
      attrs.stroke_width = config.text.strokeWidth
    }
  }

  return attrs
}

/**
 * Generate full overlay definition
 */
function generateOverlayDefinition(config: OverlayConfig): OverlayDefinition {
  const definition: OverlayDefinition = {
    overlay: generateOverlayAttributes(config),
  }

  // Source
  switch (config.sourceType) {
    case 'pmm':
      definition.pmm = config.pmmOverlay
      break
    case 'file':
      definition.file = config.sourcePath
      break
    case 'url':
      definition.url = config.sourcePath
      break
    case 'text':
    case 'backdrop':
      definition.plex_all = true
      break
  }

  return definition
}

/**
 * Convert object to YAML string with proper indentation
 */
function toYamlString(obj: Record<string, unknown>, indent = 0): string {
  const spaces = '  '.repeat(indent)
  let yaml = ''

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue

    if (typeof value === 'object' && !Array.isArray(value)) {
      yaml += `${spaces}${key}:\n`
      yaml += toYamlString(value as Record<string, unknown>, indent + 1)
    } else if (Array.isArray(value)) {
      yaml += `${spaces}${key}:\n`
      for (const item of value) {
        if (typeof item === 'object') {
          yaml += `${spaces}  -\n`
          yaml += toYamlString(item as Record<string, unknown>, indent + 2)
        } else {
          yaml += `${spaces}  - ${item}\n`
        }
      }
    } else {
      yaml += `${spaces}${key}: ${value}\n`
    }
  }

  return yaml
}

/**
 * Generate YAML string from overlay configurations
 */
export function generateOverlayYaml(
  overlays: OverlayConfig[],
  queueConfigs?: QueueConfig[]
): string {
  // Filter to only enabled overlays
  const enabledOverlays = overlays.filter((o) => o.enabled)

  if (enabledOverlays.length === 0) {
    return '# No overlays configured\noverlays: {}\n'
  }

  // Build the YAML structure
  const yamlObj: GeneratedOverlayYaml = {
    overlays: {},
  }

  // Build queue definitions from explicit configs
  const queues = new Map<string, QueueDefinition>()

  // Add explicit queue configs if provided
  if (queueConfigs && queueConfigs.length > 0) {
    for (const queueConfig of queueConfigs) {
      queues.set(queueConfig.name, {
        horizontal_align: queueConfig.position.horizontalAlign,
        vertical_align: queueConfig.position.verticalAlign,
        horizontal_offset: queueConfig.horizontalOffset,
        vertical_offset: queueConfig.verticalOffset,
        horizontal_spacing: queueConfig.direction === 'horizontal' ? queueConfig.spacing : undefined,
        vertical_spacing: queueConfig.direction === 'vertical' ? queueConfig.spacing : undefined,
      })
    }
  }

  for (const config of enabledOverlays) {
    // Use a sanitized name as the key
    const key = config.name.replace(/[^a-zA-Z0-9_]/g, '_')
    yamlObj.overlays[key] = generateOverlayDefinition(config)

    // Fallback: infer queue from overlay if no explicit config provided
    if (config.grouping.queue && !queues.has(config.grouping.queue)) {
      queues.set(config.grouping.queue, {
        horizontal_align: config.position.horizontalAlign,
        vertical_align: config.position.verticalAlign,
        horizontal_offset: config.position.horizontalOffset,
        vertical_offset: config.position.verticalOffset,
        horizontal_spacing: 10,
        vertical_spacing: 10,
      })
    }
  }

  // Add queues if any
  if (queues.size > 0) {
    yamlObj.queues = Object.fromEntries(queues)
  }

  return toYamlString(yamlObj as unknown as Record<string, unknown>)
}

/**
 * Generate a preview-friendly summary of the configuration
 */
export function generateConfigSummary(overlays: OverlayConfig[]): string {
  const enabled = overlays.filter((o) => o.enabled)
  const groups = new Set(enabled.map((o) => o.grouping.group).filter(Boolean))
  const queues = new Set(enabled.map((o) => o.grouping.queue).filter(Boolean))

  const lines = [
    `# Overlay Configuration Summary`,
    `# =============================`,
    `# Active overlays: ${enabled.length}`,
    `# Groups: ${groups.size > 0 ? [...groups].join(', ') : 'none'}`,
    `# Queues: ${queues.size > 0 ? [...queues].join(', ') : 'none'}`,
    ``,
  ]

  return lines.join('\n')
}

/**
 * Configuration for generating a full Kometa config
 */
export interface FullConfigOptions {
  plexUrl?: string
  plexToken?: string
  libraryName?: string
  libraryType?: 'movie' | 'show'
  includeSettings?: boolean
  includeTmdb?: boolean
}

/**
 * Generate a complete Kometa config YAML file
 * This creates a full config that can be used directly with Kometa
 */
export function generateFullKometaConfig(
  overlays: OverlayConfig[],
  queueConfigs?: QueueConfig[],
  options: FullConfigOptions = {}
): string {
  const {
    plexUrl = 'http://localhost:32400',
    plexToken = 'YOUR_PLEX_TOKEN',
    libraryName = 'Movies',
    libraryType = 'movie',
    includeSettings = true,
    includeTmdb = false,
  } = options

  const lines: string[] = []

  // Header comment
  lines.push('# Kometa Configuration')
  lines.push('# Generated by Kometa Preview Studio')
  lines.push(`# Generated: ${new Date().toISOString()}`)
  lines.push('')

  // Plex configuration
  lines.push('plex:')
  lines.push(`  url: ${plexUrl}`)
  lines.push(`  token: ${plexToken}`)
  lines.push('  timeout: 60')
  lines.push('  clean_bundles: false')
  lines.push('  empty_trash: false')
  lines.push('  optimize: false')
  lines.push('')

  // TMDb configuration (optional)
  if (includeTmdb) {
    lines.push('tmdb:')
    lines.push('  apikey: YOUR_TMDB_API_KEY')
    lines.push('  language: en')
    lines.push('  region: US')
    lines.push('')
  }

  // Settings (optional)
  if (includeSettings) {
    lines.push('settings:')
    lines.push('  cache: true')
    lines.push('  cache_expiration: 60')
    lines.push('  asset_directory:')
    lines.push('    - config/assets')
    lines.push('  asset_folders: true')
    lines.push('  asset_depth: 0')
    lines.push('  create_asset_folders: false')
    lines.push('  prioritize_assets: false')
    lines.push('  dimensional_asset_rename: false')
    lines.push('  download_url_assets: false')
    lines.push('  show_missing_season_assets: false')
    lines.push('  show_missing_episode_assets: false')
    lines.push('  show_asset_not_needed: true')
    lines.push('  sync_mode: append')
    lines.push('  minimum_items: 1')
    lines.push('  default_collection_order:')
    lines.push('  delete_below_minimum: true')
    lines.push('  delete_not_scheduled: false')
    lines.push('  run_again_delay: 2')
    lines.push('  missing_only_released: false')
    lines.push('  only_filter_missing: false')
    lines.push('  show_unmanaged: true')
    lines.push('  show_unconfigured: true')
    lines.push('  show_filtered: false')
    lines.push('  show_options: false')
    lines.push('  show_missing: true')
    lines.push('  show_missing_assets: true')
    lines.push('  save_report: false')
    lines.push('  tvdb_language: eng')
    lines.push('  ignore_ids:')
    lines.push('  ignore_imdb_ids:')
    lines.push('  item_refresh_delay: 0')
    lines.push('  playlist_sync_to_user: all')
    lines.push('  playlist_exclude_user:')
    lines.push('  playlist_report: false')
    lines.push('  verify_ssl: true')
    lines.push('  custom_repo:')
    lines.push('  check_nightly: false')
    lines.push('')
  }

  // Libraries section
  lines.push('libraries:')
  lines.push(`  ${libraryName}:`)

  // Determine library metadata type
  const metadataType = libraryType === 'movie' ? 'movies' : 'shows'
  lines.push(`    metadata_path:`)
  lines.push(`      - pmm: ${metadataType}`)
  lines.push('')

  // Overlay files section
  lines.push('    overlay_files:')

  // Generate overlay YAML
  const overlayYaml = generateOverlayYaml(overlays, queueConfigs)

  if (overlayYaml.includes('overlays: {}')) {
    lines.push('      # No overlays configured')
    lines.push('      - pmm: resolution')
  } else {
    // Embed the overlay configuration inline
    lines.push('      # Custom overlay configuration')
    lines.push('      - file: config/overlays.yml')
    lines.push('')
    lines.push('')
    lines.push('# ========================================')
    lines.push('# OVERLAY FILE CONTENTS (config/overlays.yml)')
    lines.push('# Save the content below to config/overlays.yml')
    lines.push('# ========================================')
    lines.push('')
    lines.push(overlayYaml)
  }

  return lines.join('\n')
}

/**
 * Generate only the overlay file content (for saving as overlays.yml)
 */
export function generateOverlayFileContent(
  overlays: OverlayConfig[],
  queueConfigs?: QueueConfig[]
): string {
  const lines: string[] = []

  // Header
  lines.push('# Kometa Overlay Configuration')
  lines.push('# Generated by Kometa Preview Studio')
  lines.push(`# Generated: ${new Date().toISOString()}`)
  lines.push('')

  // Generate the overlay definitions
  const overlayYaml = generateOverlayYaml(overlays, queueConfigs)
  lines.push(overlayYaml)

  return lines.join('\n')
}

/**
 * Parse simple PMM overlay references from enabled overlays
 * For simple mode where we just enable PMM defaults
 */
export function generateSimplePmmOverlays(
  enabledOverlays: Record<string, boolean>,
  preset?: string
): string {
  const lines: string[] = []

  lines.push('# Kometa Overlay Configuration (Simple Mode)')
  lines.push('# Using PMM default overlays')
  lines.push(`# Generated: ${new Date().toISOString()}`)
  lines.push('')
  lines.push('overlays:')

  const enabledKeys = Object.entries(enabledOverlays)
    .filter(([_, enabled]) => enabled)
    .map(([key]) => key)

  if (enabledKeys.length === 0) {
    lines.push('  # No overlays enabled')
    return lines.join('\n')
  }

  // Map overlay keys to PMM overlay names
  const overlayMapping: Record<string, string> = {
    resolution: 'resolution',
    audioCodec: 'audio_codec',
    versions: 'versions',
    aspectRatio: 'aspect',
    ratings: 'ratings',
    streaming: 'streaming',
    network: 'network',
    studio: 'studio',
    status: 'status',
    ribbon: 'ribbon',
  }

  for (const key of enabledKeys) {
    const pmmName = overlayMapping[key] || key
    const safeName = pmmName.replace(/[^a-zA-Z0-9_]/g, '_')

    lines.push(`  ${safeName}:`)
    lines.push(`    pmm: ${pmmName}`)

    // Add position if preset is specified
    if (preset) {
      const position = getPresetPosition(preset)
      if (position) {
        lines.push(`    overlay:`)
        lines.push(`      horizontal_align: ${position.horizontalAlign}`)
        lines.push(`      vertical_align: ${position.verticalAlign}`)
        lines.push(`      horizontal_offset: ${position.horizontalOffset}`)
        lines.push(`      vertical_offset: ${position.verticalOffset}`)
      }
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Get position values for a preset name
 */
function getPresetPosition(preset: string): {
  horizontalAlign: string
  verticalAlign: string
  horizontalOffset: number
  verticalOffset: number
} | null {
  const presets: Record<string, { h: string; v: string; ho: number; vo: number }> = {
    'top-left': { h: 'left', v: 'top', ho: 15, vo: 15 },
    'top-center': { h: 'center', v: 'top', ho: 0, vo: 15 },
    'top-right': { h: 'right', v: 'top', ho: 15, vo: 15 },
    'middle-left': { h: 'left', v: 'center', ho: 15, vo: 0 },
    'middle-center': { h: 'center', v: 'center', ho: 0, vo: 0 },
    'middle-right': { h: 'right', v: 'center', ho: 15, vo: 0 },
    'bottom-left': { h: 'left', v: 'bottom', ho: 15, vo: 15 },
    'bottom-center': { h: 'center', v: 'bottom', ho: 0, vo: 15 },
    'bottom-right': { h: 'right', v: 'bottom', ho: 15, vo: 15 },
  }

  const pos = presets[preset]
  if (!pos) return null

  return {
    horizontalAlign: pos.h,
    verticalAlign: pos.v,
    horizontalOffset: pos.ho,
    verticalOffset: pos.vo,
  }
}
