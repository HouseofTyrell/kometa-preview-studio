import { useState } from 'react'

interface OverlayEditorProps {
  overlayYaml: string
  onEdit: (fullConfig: string) => void
  fullConfig: string
}

function OverlayEditor({ overlayYaml, onEdit, fullConfig }: OverlayEditorProps) {
  const [editedYaml, setEditedYaml] = useState(overlayYaml)
  const [isEditing, setIsEditing] = useState(false)

  const handleSave = () => {
    // For v0, we just pass the full config back
    // In a more advanced version, we'd merge the edited overlay sections
    // back into the full config
    onEdit(fullConfig)
    setIsEditing(false)
  }

  const handleReset = () => {
    setEditedYaml(overlayYaml)
    setIsEditing(false)
  }

  return (
    <div className="card overlay-editor">
      <div className="editor-header">
        <h2 className="card-title">Overlay Configuration</h2>
        <div className="editor-actions">
          {isEditing ? (
            <>
              <button className="btn btn-secondary btn-sm" onClick={handleReset}>
                Reset
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleSave}>
                Save Changes
              </button>
            </>
          ) : (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setIsEditing(true)}
            >
              Edit
            </button>
          )}
        </div>
      </div>

      <p className="text-sm text-muted mb-2">
        This shows the overlay-related sections extracted from your config.
        {!isEditing && ' Click Edit to modify.'}
      </p>

      <div className="form-group">
        <textarea
          className="form-textarea editor-textarea"
          value={editedYaml}
          onChange={(e) => {
            setEditedYaml(e.target.value)
            setIsEditing(true)
          }}
          readOnly={!isEditing}
          rows={20}
        />
      </div>

      <style>{`
        .overlay-editor {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .editor-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
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
