import { useState, useCallback, useMemo } from 'react'
import BuiltinOverlayLibrary from './BuiltinOverlayLibrary'
import OverlayPropertiesPanel from './OverlayPropertiesPanel'
import ActiveOverlaysList from './ActiveOverlaysList'
import QueueConfigPanel from './QueueConfigPanel'
import CustomImageUpload from './CustomImageUpload'
import PosterPreview from './PosterPreview'
import YamlView from './YamlView'
import {
  OverlayConfig,
  BuiltinOverlay,
  QueueConfig,
  createOverlayConfig,
  createTextOverlayConfig,
} from '../../types/overlayConfig'
import { generateOverlayYaml } from '../../utils/overlayYamlGenerator'
import './VisualOverlayEditor.css'

interface VisualOverlayEditorProps {
  initialOverlays?: OverlayConfig[]
  initialQueues?: QueueConfig[]
  onConfigChange?: (overlays: OverlayConfig[], queues: QueueConfig[], yaml: string) => void
  disabled?: boolean
}

function VisualOverlayEditor({
  initialOverlays = [],
  initialQueues = [],
  onConfigChange,
  disabled = false,
}: VisualOverlayEditorProps) {
  const [overlays, setOverlays] = useState<OverlayConfig[]>(initialOverlays)
  const [queues, setQueues] = useState<QueueConfig[]>(initialQueues)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'visual' | 'yaml'>('visual')
  const [showQueuesPanel, setShowQueuesPanel] = useState(false)

  // Get the selected overlay
  const selectedOverlay = useMemo(
    () => overlays.find((o) => o.id === selectedId) || null,
    [overlays, selectedId]
  )

  // Generate YAML from current config
  const generatedYaml = useMemo(() => generateOverlayYaml(overlays, queues), [overlays, queues])

  // Get list of added overlay base IDs (for library highlighting)
  const addedOverlayIds = useMemo(
    () => overlays.map((o) => o.pmmOverlay || o.id.split('-')[0]),
    [overlays]
  )

  // Get available queue names
  const availableQueues = useMemo(() => queues.map((q) => q.name), [queues])

  // Notify parent of changes
  const notifyChange = useCallback(
    (newOverlays: OverlayConfig[], newQueues?: QueueConfig[]) => {
      if (onConfigChange) {
        const yaml = generateOverlayYaml(newOverlays, newQueues || queues)
        onConfigChange(newOverlays, newQueues || queues, yaml)
      }
    },
    [onConfigChange, queues]
  )

  // Add a new overlay from library
  const handleAddOverlay = useCallback(
    (builtin: BuiltinOverlay) => {
      const newOverlay = createOverlayConfig(builtin)
      const newOverlays = [...overlays, newOverlay]
      setOverlays(newOverlays)
      setSelectedId(newOverlay.id)
      notifyChange(newOverlays)
    },
    [overlays, notifyChange]
  )

  // Add a new text overlay
  const handleAddTextOverlay = useCallback(() => {
    const newOverlay = createTextOverlayConfig('New Text')
    const newOverlays = [...overlays, newOverlay]
    setOverlays(newOverlays)
    setSelectedId(newOverlay.id)
    notifyChange(newOverlays)
  }, [overlays, notifyChange])

  // Add a custom overlay (from file or URL)
  const handleAddCustomOverlay = useCallback(
    (overlay: OverlayConfig) => {
      const newOverlays = [...overlays, overlay]
      setOverlays(newOverlays)
      setSelectedId(overlay.id)
      notifyChange(newOverlays)
    },
    [overlays, notifyChange]
  )

  // Update an overlay
  const handleUpdateOverlay = useCallback(
    (updated: OverlayConfig) => {
      const newOverlays = overlays.map((o) => (o.id === updated.id ? updated : o))
      setOverlays(newOverlays)
      notifyChange(newOverlays)
    },
    [overlays, notifyChange]
  )

  // Delete an overlay
  const handleDeleteOverlay = useCallback(
    (id: string) => {
      const newOverlays = overlays.filter((o) => o.id !== id)
      setOverlays(newOverlays)
      if (selectedId === id) {
        setSelectedId(newOverlays.length > 0 ? newOverlays[0].id : null)
      }
      notifyChange(newOverlays)
    },
    [overlays, selectedId, notifyChange]
  )

  // Toggle overlay enabled state
  const handleToggleOverlay = useCallback(
    (id: string, enabled: boolean) => {
      const newOverlays = overlays.map((o) => (o.id === id ? { ...o, enabled } : o))
      setOverlays(newOverlays)
      notifyChange(newOverlays)
    },
    [overlays, notifyChange]
  )

  // Reorder overlays
  const handleReorderOverlays = useCallback(
    (newOverlays: OverlayConfig[]) => {
      setOverlays(newOverlays)
      notifyChange(newOverlays)
    },
    [notifyChange]
  )

  // Queue management
  const handleQueuesChange = useCallback(
    (newQueues: QueueConfig[]) => {
      setQueues(newQueues)
      notifyChange(overlays, newQueues)
    },
    [overlays, notifyChange]
  )

  // Change overlay queue assignment
  const handleOverlayQueueChange = useCallback(
    (overlayId: string, queueName: string | undefined) => {
      const newOverlays = overlays.map((o) =>
        o.id === overlayId ? { ...o, grouping: { ...o.grouping, queue: queueName } } : o
      )
      setOverlays(newOverlays)
      notifyChange(newOverlays)
    },
    [overlays, notifyChange]
  )

  return (
    <div className="visual-overlay-editor">
      {/* Header */}
      <div className="editor-header">
        <h2 className="editor-title">Overlay Editor</h2>
        <div className="header-controls">
          <button
            type="button"
            className={`queues-btn ${showQueuesPanel ? 'active' : ''}`}
            onClick={() => setShowQueuesPanel(!showQueuesPanel)}
            disabled={disabled}
          >
            Queues {queues.length > 0 && `(${queues.length})`}
          </button>
          <div className="view-toggle">
            <button
              type="button"
              className={`toggle-btn ${viewMode === 'visual' ? 'active' : ''}`}
              onClick={() => setViewMode('visual')}
            >
              Visual
            </button>
            <button
              type="button"
              className={`toggle-btn ${viewMode === 'yaml' ? 'active' : ''}`}
              onClick={() => setViewMode('yaml')}
            >
              YAML
            </button>
          </div>
        </div>
      </div>

      {/* Queues Panel (collapsible) */}
      {showQueuesPanel && (
        <div className="queues-panel-container">
          <QueueConfigPanel
            queues={queues}
            overlays={overlays}
            onQueuesChange={handleQueuesChange}
            onOverlayQueueChange={handleOverlayQueueChange}
            disabled={disabled}
          />
        </div>
      )}

      {viewMode === 'visual' ? (
        <div className="editor-content">
          {/* Left: Library */}
          <div className="editor-library">
            <BuiltinOverlayLibrary
              onAddOverlay={handleAddOverlay}
              addedOverlayIds={addedOverlayIds}
              disabled={disabled}
            />
            <div className="create-text-section">
              <button
                type="button"
                className="create-text-btn"
                onClick={handleAddTextOverlay}
                disabled={disabled}
              >
                <span className="btn-icon">T</span>
                <span>Create Text Overlay</span>
              </button>
            </div>
            <CustomImageUpload onAddOverlay={handleAddCustomOverlay} disabled={disabled} />
          </div>

          {/* Center: Active List + Preview Area */}
          <div className="editor-main">
            <PosterPreview overlays={overlays} selectedId={selectedId} onSelect={setSelectedId} />
            <ActiveOverlaysList
              overlays={overlays}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onToggle={handleToggleOverlay}
              onReorder={handleReorderOverlays}
              onDelete={handleDeleteOverlay}
              disabled={disabled}
            />
          </div>

          {/* Right: Properties */}
          <div className="editor-properties">
            <OverlayPropertiesPanel
              overlay={selectedOverlay}
              overlays={overlays}
              availableQueues={availableQueues}
              onChange={handleUpdateOverlay}
              onDelete={handleDeleteOverlay}
              disabled={disabled}
            />
          </div>
        </div>
      ) : (
        <YamlView yaml={generatedYaml} disabled={disabled} />
      )}
    </div>
  )
}

export default VisualOverlayEditor
