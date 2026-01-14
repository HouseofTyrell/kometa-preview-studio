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
