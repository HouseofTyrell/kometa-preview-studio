import { OverlayConfig, QueueConfig } from '../types/overlayConfig'

/**
 * Converts simple mode manual config (enabled overlays + preset) to advanced mode overlay configs
 * Note: This is currently a placeholder. In simple mode, we use PMM references directly.
 * In advanced mode, users work with the full visual overlay editor.
 */
export function manualConfigToOverlays(
  _enabledOverlays: Record<string, boolean>,
  _selectedPreset: string | null
): { overlays: OverlayConfig[]; queues: QueueConfig[] } {
  // Return empty for now - simple mode uses PMM references, not full overlay configs
  return { overlays: [], queues: [] }
}

