import { OverlayConfig, QueueConfig } from '../types/overlayConfig'

// Export format version for future compatibility
const EXPORT_VERSION = '1.0'

interface OverlayExportData {
  version: string
  exportDate: string
  type: 'single' | 'multiple' | 'full'
  overlays: OverlayConfig[]
  queues?: QueueConfig[]
}

/**
 * Export a single overlay as JSON file
 */
export function exportOverlay(overlay: OverlayConfig): void {
  const exportData: OverlayExportData = {
    version: EXPORT_VERSION,
    exportDate: new Date().toISOString(),
    type: 'single',
    overlays: [overlay],
  }

  const filename = `overlay-${overlay.name}-${Date.now()}.json`
  downloadJson(exportData, filename)
}

/**
 * Export multiple overlays as JSON file
 */
export function exportOverlays(
  overlays: OverlayConfig[],
  queues?: QueueConfig[]
): void {
  const exportData: OverlayExportData = {
    version: EXPORT_VERSION,
    exportDate: new Date().toISOString(),
    type: queues ? 'full' : 'multiple',
    overlays,
    queues,
  }

  const filename = `overlays-export-${Date.now()}.json`
  downloadJson(exportData, filename)
}

/**
 * Download JSON data as a file
 */
function downloadJson(data: object, filename: string): void {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  URL.revokeObjectURL(url)
}

/**
 * Parse and validate imported overlay data
 */
export function parseImportedOverlays(
  jsonString: string
): { overlays: OverlayConfig[]; queues?: QueueConfig[] } | { error: string } {
  try {
    const data = JSON.parse(jsonString)

    // Check if it's our export format
    if (data.version && data.overlays) {
      const exportData = data as OverlayExportData

      // Validate overlays
      if (!Array.isArray(exportData.overlays)) {
        return { error: 'Invalid overlay data: overlays must be an array' }
      }

      // Validate each overlay has required fields
      for (const overlay of exportData.overlays) {
        if (!overlay.id || !overlay.name || !overlay.sourceType) {
          return { error: 'Invalid overlay: missing required fields (id, name, sourceType)' }
        }
      }

      // Generate new IDs to avoid conflicts
      const overlays = exportData.overlays.map((o) => ({
        ...o,
        id: `${o.sourceType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      }))

      // Also update queue IDs if present
      const queues = exportData.queues?.map((q) => ({
        ...q,
        id: `queue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      }))

      return { overlays, queues }
    }

    // Try to handle raw overlay config array
    if (Array.isArray(data)) {
      const overlays = data.map((o) => ({
        ...o,
        id: `${o.sourceType || 'import'}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      }))
      return { overlays }
    }

    // Try to handle single overlay
    if (data.name && data.sourceType) {
      const overlay = {
        ...data,
        id: `${data.sourceType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      }
      return { overlays: [overlay] }
    }

    return { error: 'Unrecognized import format' }
  } catch {
    return { error: 'Invalid JSON format' }
  }
}

/**
 * Read file contents as text
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}
