import { useState, useCallback } from 'react'
import { VisualOverlayEditor } from './overlay-editor'
import { OverlayConfig } from '../types/overlayConfig'

interface OverlayEditorProps {
  overlayYaml: string
  onEdit: (fullConfig: string) => void
  fullConfig: string
}

type EditorMode = 'visual' | 'raw'

function OverlayEditor({ overlayYaml, onEdit, fullConfig }: OverlayEditorProps) {
  const [mode, setMode] = useState<EditorMode>('visual')
  const [editedYaml, setEditedYaml] = useState(overlayYaml)
  const [isRawEditing, setIsRawEditing] = useState(false)
  const [visualOverlays, setVisualOverlays] = useState<OverlayConfig[]>([])

  const handleRawSave = useCallback(() => {
    // For now, pass the full config back unchanged
    // In a more advanced version, we'd merge edited overlay sections
    onEdit(fullConfig)
    setIsRawEditing(false)
  }, [fullConfig, onEdit])

  const handleRawReset = useCallback(() => {
    setEditedYaml(overlayYaml)
    setIsRawEditing(false)
  }, [overlayYaml])

  const handleVisualChange = useCallback(
    (overlays: OverlayConfig[], yaml: string) => {
      setVisualOverlays(overlays)
      // In a future version, we'd merge this into the full config
      console.log('Visual editor produced YAML:', yaml)
    },
    []
  )

  return (
    <div className="overlay-editor-container">
      {/* Mode Tabs */}
      <div className="editor-tabs">
        <button
          type="button"
          className={`tab-btn ${mode === 'visual' ? 'active' : ''}`}
          onClick={() => setMode('visual')}
        >
          Visual Editor
        </button>
        <button
          type="button"
          className={`tab-btn ${mode === 'raw' ? 'active' : ''}`}
          onClick={() => setMode('raw')}
        >
          Raw YAML
        </button>
      </div>

      {mode === 'visual' ? (
        <div className="visual-editor-wrapper">
          <VisualOverlayEditor
            initialOverlays={visualOverlays}
            onConfigChange={handleVisualChange}
          />
        </div>
      ) : (
        <div className="card raw-editor">
          <div className="editor-header">
            <h3 className="editor-subtitle">Overlay Configuration (YAML)</h3>
            <div className="editor-actions">
              {isRawEditing ? (
                <>
                  <button className="btn btn-secondary btn-sm" onClick={handleRawReset}>
                    Reset
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={handleRawSave}>
                    Save Changes
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setIsRawEditing(true)}
                >
                  Edit
                </button>
              )}
            </div>
          </div>

          <p className="text-sm text-muted mb-2">
            This shows the overlay-related sections extracted from your config.
            {!isRawEditing && ' Click Edit to modify.'}
          </p>

          <div className="form-group">
            <textarea
              className="form-textarea editor-textarea"
              value={editedYaml}
              onChange={(e) => {
                setEditedYaml(e.target.value)
                setIsRawEditing(true)
              }}
              readOnly={!isRawEditing}
              rows={20}
            />
          </div>
        </div>
      )}

      <style>{`
        .overlay-editor-container {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .editor-tabs {
          display: flex;
          gap: 0.5rem;
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 0.5rem;
        }

        .tab-btn {
          padding: 0.5rem 1rem;
          border: none;
          background: none;
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--text-secondary);
          cursor: pointer;
          border-radius: var(--radius-sm);
          transition: all 0.15s;
        }

        .tab-btn:hover {
          color: var(--text-primary);
          background-color: var(--bg-secondary);
        }

        .tab-btn.active {
          color: var(--primary);
          background-color: var(--primary-light, rgba(99, 102, 241, 0.1));
        }

        .visual-editor-wrapper {
          min-height: 600px;
        }

        .raw-editor {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .editor-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .editor-subtitle {
          margin: 0;
          font-size: 0.875rem;
          font-weight: 600;
        }

        .editor-actions {
          display: flex;
          gap: 0.5rem;
        }

        .editor-textarea {
          font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
          font-size: 0.8125rem;
          line-height: 1.6;
          background-color: var(--bg-primary);
        }

        .editor-textarea:read-only {
          opacity: 0.8;
        }
      `}</style>
    </div>
  )
}

export default OverlayEditor
