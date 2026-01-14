import { useState, useCallback, useMemo } from 'react'
import BuiltinOverlayLibrary from './BuiltinOverlayLibrary'
import OverlayPropertiesPanel from './OverlayPropertiesPanel'
import ActiveOverlaysList from './ActiveOverlaysList'
import {
  OverlayConfig,
  BuiltinOverlay,
  createOverlayConfig,
} from '../../types/overlayConfig'
import { generateOverlayYaml } from '../../utils/overlayYamlGenerator'

interface VisualOverlayEditorProps {
  initialOverlays?: OverlayConfig[]
  onConfigChange?: (overlays: OverlayConfig[], yaml: string) => void
  disabled?: boolean
}

function VisualOverlayEditor({
  initialOverlays = [],
  onConfigChange,
  disabled = false,
}: VisualOverlayEditorProps) {
  const [overlays, setOverlays] = useState<OverlayConfig[]>(initialOverlays)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'visual' | 'yaml'>('visual')

  // Get the selected overlay
  const selectedOverlay = useMemo(
    () => overlays.find((o) => o.id === selectedId) || null,
    [overlays, selectedId]
  )

  // Generate YAML from current config
  const generatedYaml = useMemo(() => generateOverlayYaml(overlays), [overlays])

  // Get list of added overlay base IDs (for library highlighting)
  const addedOverlayIds = useMemo(
    () => overlays.map((o) => o.pmmOverlay || o.id.split('-')[0]),
    [overlays]
  )

  // Notify parent of changes
  const notifyChange = useCallback(
    (newOverlays: OverlayConfig[]) => {
      if (onConfigChange) {
        const yaml = generateOverlayYaml(newOverlays)
        onConfigChange(newOverlays, yaml)
      }
    },
    [onConfigChange]
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

  return (
    <div className="visual-overlay-editor">
      {/* Header */}
      <div className="editor-header">
        <h2 className="editor-title">Overlay Editor</h2>
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

      {viewMode === 'visual' ? (
        <div className="editor-content">
          {/* Left: Library */}
          <div className="editor-library">
            <BuiltinOverlayLibrary
              onAddOverlay={handleAddOverlay}
              addedOverlayIds={addedOverlayIds}
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
              onChange={handleUpdateOverlay}
              onDelete={handleDeleteOverlay}
              disabled={disabled}
            />
          </div>
        </div>
      ) : (
        <div className="yaml-view">
          <div className="yaml-header">
            <span className="yaml-label">Generated YAML Configuration</span>
            <button
              type="button"
              className="copy-btn"
              onClick={() => navigator.clipboard.writeText(generatedYaml)}
              title="Copy to clipboard"
            >
              Copy
            </button>
          </div>
          <pre className="yaml-content">{generatedYaml}</pre>
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
          border-right: 1px solid var(--border-color);
          overflow: hidden;
        }

        .editor-library > * {
          height: 100%;
          border: none;
          border-radius: 0;
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

        .copy-btn {
          padding: 0.375rem 0.75rem;
          background-color: var(--primary);
          color: white;
          border: none;
          border-radius: var(--radius-sm);
          font-size: 0.75rem;
          font-weight: 500;
          cursor: pointer;
        }

        .copy-btn:hover {
          opacity: 0.9;
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
