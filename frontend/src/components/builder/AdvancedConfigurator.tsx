import { useEffect, useState } from 'react'
import VisualOverlayEditor from '../overlay-editor/VisualOverlayEditor'
import { OverlayConfig, QueueConfig } from '../../types/overlayConfig'
import { manualConfigToOverlays } from '../../utils/builderConversion'
import './AdvancedConfigurator.css'

interface AdvancedConfiguratorProps {
  enabledOverlays: Record<string, boolean>
  selectedPreset: string | null
  onOverlaysChange: (overlays: OverlayConfig[], queues: QueueConfig[]) => void
}

function AdvancedConfigurator({
  enabledOverlays,
  selectedPreset,
  onOverlaysChange,
}: AdvancedConfiguratorProps) {
  const [initialOverlays, setInitialOverlays] = useState<OverlayConfig[]>([])
  const [initialQueues, setInitialQueues] = useState<QueueConfig[]>([])

  // Convert simple mode config to advanced mode overlays when entering advanced mode
  useEffect(() => {
    const converted = manualConfigToOverlays(enabledOverlays, selectedPreset)
    setInitialOverlays(converted.overlays)
    setInitialQueues(converted.queues)
  }, []) // Only run once on mount

  const handleConfigChange = (overlays: OverlayConfig[], queues: QueueConfig[], _yaml: string) => {
    onOverlaysChange(overlays, queues)
  }

  return (
    <div className="advanced-configurator">
      <div className="advanced-header">
        <h4>Advanced Overlay Editor</h4>
        <p className="advanced-description">
          Full control over overlay positioning, styling, and configuration
        </p>
      </div>
      <VisualOverlayEditor
        initialOverlays={initialOverlays}
        initialQueues={initialQueues}
        onConfigChange={handleConfigChange}
      />
    </div>
  )
}

export default AdvancedConfigurator
