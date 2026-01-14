import { useState, useCallback } from 'react'

interface YamlViewProps {
  yaml: string
  disabled?: boolean
}

/**
 * YAML view/edit panel for overlay configuration
 */
function YamlView({ yaml, disabled = false }: YamlViewProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editedYaml, setEditedYaml] = useState('')
  const [error, setError] = useState('')

  const handleStartEdit = useCallback(() => {
    setEditedYaml(yaml)
    setIsEditing(true)
    setError('')
  }, [yaml])

  const handleCancel = useCallback(() => {
    setIsEditing(false)
    setEditedYaml('')
    setError('')
  }, [])

  const handleApply = useCallback(() => {
    // Basic syntax validation
    const lines = editedYaml.split('\n')
    let hasError = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // Skip empty lines and comments
      if (line.trim() === '' || line.trim().startsWith('#')) continue

      // Check for tabs (YAML doesn't allow tabs)
      if (line.includes('\t')) {
        setError(`Line ${i + 1}: YAML does not allow tabs for indentation`)
        hasError = true
        break
      }

      // Check for valid key-value structure (basic check)
      if (!line.startsWith(' ') && !line.includes(':')) {
        setError(`Line ${i + 1}: Invalid YAML structure`)
        hasError = true
        break
      }
    }

    if (hasError) return

    // For now, we accept the YAML as-is but don't parse it back to config
    setError('Note: Raw YAML edits are for export only. Visual editor state is preserved.')
    setIsEditing(false)
  }, [editedYaml])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(yaml)
  }, [yaml])

  return (
    <div className="yaml-view">
      <div className="yaml-header">
        <span className="yaml-label">
          {isEditing ? 'Edit YAML Configuration' : 'Generated YAML Configuration'}
        </span>
        <div className="yaml-actions">
          {isEditing ? (
            <>
              <button type="button" className="cancel-btn" onClick={handleCancel}>
                Cancel
              </button>
              <button type="button" className="apply-btn" onClick={handleApply}>
                Apply
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="edit-btn"
                onClick={handleStartEdit}
                disabled={disabled}
              >
                Edit
              </button>
              <button
                type="button"
                className="copy-btn"
                onClick={handleCopy}
                title="Copy to clipboard"
              >
                Copy
              </button>
            </>
          )}
        </div>
      </div>
      {error && (
        <div className={`yaml-message ${error.startsWith('Note:') ? 'info' : 'error'}`}>
          {error}
        </div>
      )}
      {isEditing ? (
        <textarea
          className="yaml-editor"
          value={editedYaml}
          onChange={(e) => setEditedYaml(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <pre className="yaml-content">{yaml}</pre>
      )}
    </div>
  )
}

export default YamlView
