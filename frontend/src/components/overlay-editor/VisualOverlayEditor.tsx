import { useState, useCallback, useMemo } from 'react'
import BuiltinOverlayLibrary from './BuiltinOverlayLibrary'
import OverlayPropertiesPanel from './OverlayPropertiesPanel'
import ActiveOverlaysList from './ActiveOverlaysList'
import QueueConfigPanel from './QueueConfigPanel'
import CustomImageUpload from './CustomImageUpload'
import {
  OverlayConfig,
  BuiltinOverlay,
  QueueConfig,
  createOverlayConfig,
  createTextOverlayConfig,
} from '../../types/overlayConfig'
import { generateOverlayYaml } from '../../utils/overlayYamlGenerator'

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
  const [isEditingYaml, setIsEditingYaml] = useState(false)
  const [editedYaml, setEditedYaml] = useState('')
  const [yamlError, setYamlError] = useState('')

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
  const availableQueues = useMemo(
    () => queues.map((q) => q.name),
    [queues]
  )

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
      const newOverlays = overlays.map((o) =>
        o.id === id ? { ...o, enabled } : o
      )
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
        o.id === overlayId
          ? { ...o, grouping: { ...o.grouping, queue: queueName } }
          : o
      )
      setOverlays(newOverlays)
      notifyChange(newOverlays)
    },
    [overlays, notifyChange]
  )

  // Start editing YAML
  const handleStartYamlEdit = useCallback(() => {
    setEditedYaml(generatedYaml)
    setIsEditingYaml(true)
    setYamlError('')
  }, [generatedYaml])

  // Cancel YAML editing
  const handleCancelYamlEdit = useCallback(() => {
    setIsEditingYaml(false)
    setEditedYaml('')
    setYamlError('')
  }, [])

  // Apply edited YAML (basic validation only - full parsing would need a YAML library)
  const handleApplyYaml = useCallback(() => {
    // Basic syntax validation
    const lines = editedYaml.split('\n')
    let hasError = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // Skip empty lines and comments
      if (line.trim() === '' || line.trim().startsWith('#')) continue

      // Check for tabs (YAML doesn't allow tabs)
      if (line.includes('\t')) {
        setYamlError(`Line ${i + 1}: YAML does not allow tabs for indentation`)
        hasError = true
        break
      }

      // Check for valid key-value structure (basic check)
      if (!line.startsWith(' ') && !line.includes(':')) {
        setYamlError(`Line ${i + 1}: Invalid YAML structure`)
        hasError = true
        break
      }
    }

    if (hasError) return

    // For now, we accept the YAML as-is but don't parse it back to config
    // Full bi-directional editing would require a YAML parser
    setYamlError('Note: Raw YAML edits are for export only. Visual editor state is preserved.')
    setIsEditingYaml(false)
  }, [editedYaml])

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
            <CustomImageUpload
              onAddOverlay={handleAddCustomOverlay}
              disabled={disabled}
            />
          </div>

          {/* Center: Active List + Preview Area */}
          <div className="editor-main">
            <div className="preview-placeholder">
              <div className="poster-frame">
                <div className="poster-content">
                  {/* Show overlay position indicators */}
                  {overlays
                    .filter((o) => o.enabled)
                    .map((overlay) => (
                      <div
                        key={overlay.id}
                        className={`overlay-indicator ${
                          selectedId === overlay.id ? 'selected' : ''
                        }`}
                        style={{
                          [overlay.position.verticalAlign]: `${overlay.position.verticalOffset}px`,
                          [overlay.position.horizontalAlign]: `${overlay.position.horizontalOffset}px`,
                        }}
                        onClick={() => setSelectedId(overlay.id)}
                        title={overlay.displayName}
                      >
                        {overlay.displayName.slice(0, 3).toUpperCase()}
                      </div>
                    ))}

                  {overlays.filter((o) => o.enabled).length === 0 && (
                    <div className="preview-empty">
                      Add overlays from the library
                    </div>
                  )}
                </div>
              </div>
              <p className="preview-hint">
                Preview shows approximate overlay positions. Run a full preview to see actual rendering.
              </p>
            </div>

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
        <div className="yaml-view">
          <div className="yaml-header">
            <span className="yaml-label">
              {isEditingYaml ? 'Edit YAML Configuration' : 'Generated YAML Configuration'}
            </span>
            <div className="yaml-actions">
              {isEditingYaml ? (
                <>
                  <button
                    type="button"
                    className="cancel-btn"
                    onClick={handleCancelYamlEdit}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="apply-btn"
                    onClick={handleApplyYaml}
                  >
                    Apply
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="edit-btn"
                    onClick={handleStartYamlEdit}
                    disabled={disabled}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="copy-btn"
                    onClick={() => navigator.clipboard.writeText(generatedYaml)}
                    title="Copy to clipboard"
                  >
                    Copy
                  </button>
                </>
              )}
            </div>
          </div>
          {yamlError && (
            <div className={`yaml-message ${yamlError.startsWith('Note:') ? 'info' : 'error'}`}>
              {yamlError}
            </div>
          )}
          {isEditingYaml ? (
            <textarea
              className="yaml-editor"
              value={editedYaml}
              onChange={(e) => setEditedYaml(e.target.value)}
              spellCheck={false}
            />
          ) : (
            <pre className="yaml-content">{generatedYaml}</pre>
          )}
        </div>
      )}

      <style>{`
        .visual-overlay-editor {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 500px;
          background-color: var(--bg-primary);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-color);
          overflow: hidden;
        }

        .editor-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem 1rem;
          background-color: var(--bg-secondary);
          border-bottom: 1px solid var(--border-color);
        }

        .editor-title {
          margin: 0;
          font-size: 1rem;
          font-weight: 600;
        }

        .header-controls {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .queues-btn {
          padding: 0.375rem 0.75rem;
          background-color: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-sm);
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.15s;
        }

        .queues-btn:hover:not(:disabled) {
          border-color: var(--primary);
          color: var(--primary);
        }

        .queues-btn.active {
          background-color: var(--primary);
          border-color: var(--primary);
          color: white;
        }

        .queues-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .queues-panel-container {
          border-bottom: 1px solid var(--border-color);
          max-height: 350px;
          overflow: hidden;
        }

        .queues-panel-container > * {
          border: none;
          border-radius: 0;
        }

        .view-toggle {
          display: flex;
          background-color: var(--bg-tertiary);
          border-radius: var(--radius-sm);
          padding: 2px;
        }

        .toggle-btn {
          padding: 0.375rem 0.75rem;
          border: none;
          background: none;
          border-radius: var(--radius-sm);
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.15s;
        }

        .toggle-btn:hover {
          color: var(--text-primary);
        }

        .toggle-btn.active {
          background-color: var(--bg-primary);
          color: var(--text-primary);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        }

        .editor-content {
          display: grid;
          grid-template-columns: 250px 1fr 280px;
          flex: 1;
          overflow: hidden;
        }

        .editor-library {
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--border-color);
          overflow: hidden;
        }

        .editor-library > *:first-child {
          flex: 1;
          border: none;
          border-radius: 0;
          overflow: auto;
        }

        .create-text-section {
          padding: 0.75rem;
          border-top: 1px solid var(--border-color);
          background-color: var(--bg-secondary);
        }

        .create-text-btn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 0.625rem 1rem;
          background-color: var(--bg-primary);
          border: 1px dashed var(--border-color);
          border-radius: var(--radius-sm);
          cursor: pointer;
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--text-secondary);
          transition: all 0.15s;
        }

        .create-text-btn:hover:not(:disabled) {
          border-color: var(--primary);
          color: var(--primary);
          background-color: var(--primary-light, rgba(99, 102, 241, 0.1));
        }

        .create-text-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          background-color: var(--bg-tertiary);
          border-radius: var(--radius-sm);
          font-weight: bold;
        }

        .editor-main {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          padding: 1rem;
          overflow-y: auto;
        }

        .preview-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
        }

        .poster-frame {
          width: 200px;
          height: 300px;
          background-color: var(--bg-secondary);
          border: 2px dashed var(--border-color);
          border-radius: var(--radius-md);
          position: relative;
          overflow: hidden;
        }

        .poster-content {
          width: 100%;
          height: 100%;
          position: relative;
        }

        .overlay-indicator {
          position: absolute;
          padding: 0.25rem 0.5rem;
          background-color: var(--primary);
          color: white;
          font-size: 0.625rem;
          font-weight: bold;
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all 0.15s;
        }

        .overlay-indicator:hover {
          transform: scale(1.1);
        }

        .overlay-indicator.selected {
          background-color: var(--success);
          box-shadow: 0 0 0 2px white, 0 0 0 4px var(--success);
        }

        .preview-empty {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
          color: var(--text-muted);
          font-size: 0.75rem;
        }

        .preview-hint {
          font-size: 0.75rem;
          color: var(--text-muted);
          text-align: center;
          margin: 0;
        }

        .editor-properties {
          border-left: 1px solid var(--border-color);
          overflow: hidden;
        }

        .editor-properties > * {
          height: 100%;
          border: none;
          border-radius: 0;
        }

        .yaml-view {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .yaml-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem 1rem;
          background-color: var(--bg-secondary);
          border-bottom: 1px solid var(--border-color);
        }

        .yaml-label {
          font-size: 0.875rem;
          font-weight: 500;
        }

        .yaml-actions {
          display: flex;
          gap: 0.5rem;
        }

        .copy-btn,
        .edit-btn,
        .apply-btn,
        .cancel-btn {
          padding: 0.375rem 0.75rem;
          border: none;
          border-radius: var(--radius-sm);
          font-size: 0.75rem;
          font-weight: 500;
          cursor: pointer;
        }

        .copy-btn,
        .apply-btn {
          background-color: var(--primary);
          color: white;
        }

        .edit-btn {
          background-color: var(--bg-tertiary);
          color: var(--text-primary);
          border: 1px solid var(--border-color);
        }

        .cancel-btn {
          background-color: var(--bg-tertiary);
          color: var(--text-secondary);
        }

        .copy-btn:hover,
        .apply-btn:hover {
          opacity: 0.9;
        }

        .edit-btn:hover,
        .cancel-btn:hover {
          background-color: var(--bg-secondary);
        }

        .edit-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .yaml-message {
          padding: 0.5rem 1rem;
          font-size: 0.75rem;
          border-bottom: 1px solid var(--border-color);
        }

        .yaml-message.error {
          background-color: rgba(239, 68, 68, 0.1);
          color: var(--error);
        }

        .yaml-message.info {
          background-color: rgba(59, 130, 246, 0.1);
          color: var(--info, #3b82f6);
        }

        .yaml-content {
          flex: 1;
          margin: 0;
          padding: 1rem;
          background-color: var(--bg-tertiary);
          overflow: auto;
          font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
          font-size: 0.8125rem;
          line-height: 1.6;
          white-space: pre;
        }

        .yaml-editor {
          flex: 1;
          margin: 0;
          padding: 1rem;
          background-color: var(--bg-tertiary);
          border: none;
          resize: none;
          font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
          font-size: 0.8125rem;
          line-height: 1.6;
          color: var(--text-primary);
        }

        .yaml-editor:focus {
          outline: none;
          background-color: var(--bg-secondary);
        }

        @media (max-width: 900px) {
          .editor-content {
            grid-template-columns: 1fr;
            grid-template-rows: auto 1fr auto;
          }

          .editor-library,
          .editor-properties {
            border: none;
            border-bottom: 1px solid var(--border-color);
          }

          .editor-library > *,
          .editor-properties > * {
            height: auto;
            max-height: 250px;
          }
        }
      `}</style>
    </div>
  )
}

export default VisualOverlayEditor
