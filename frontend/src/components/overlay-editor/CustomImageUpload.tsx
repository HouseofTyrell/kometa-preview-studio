import { useRef, useState, useCallback } from 'react'
import { OverlayConfig, createFileOverlayConfig, createUrlOverlayConfig } from '../../types/overlayConfig'

interface CustomImageUploadProps {
  onAddOverlay: (overlay: OverlayConfig) => void
  disabled?: boolean
}

type TabMode = 'file' | 'url'

function CustomImageUpload({ onAddOverlay, disabled = false }: CustomImageUploadProps) {
  const [activeTab, setActiveTab] = useState<TabMode>('file')
  const [isDragging, setIsDragging] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [urlError, setUrlError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Handle file selection
  const handleFileSelect = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return

      Array.from(files).forEach((file) => {
        // Validate file type
        if (!file.type.startsWith('image/')) {
          return
        }

        // Create a local preview URL
        const previewUrl = URL.createObjectURL(file)

        // Extract name from filename (without extension)
        const fileName = file.name.replace(/\.[^/.]+$/, '')

        // For now, use a placeholder path - in real usage, this would be
        // uploaded to the Kometa assets folder
        const filePath = `/config/assets/overlays/${file.name}`

        const overlay = createFileOverlayConfig(fileName, filePath, previewUrl)
        onAddOverlay(overlay)
      })

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [onAddOverlay]
  )

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      handleFileSelect(e.dataTransfer.files)
    },
    [handleFileSelect]
  )

  // Handle URL submission
  const handleUrlSubmit = useCallback(() => {
    if (!urlInput.trim()) {
      setUrlError('Please enter a URL')
      return
    }

    // Basic URL validation
    try {
      new URL(urlInput)
    } catch {
      setUrlError('Please enter a valid URL')
      return
    }

    // Validate it's an image URL (basic check)
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']
    const hasImageExtension = imageExtensions.some((ext) =>
      urlInput.toLowerCase().includes(ext)
    )

    if (!hasImageExtension) {
      setUrlError('URL should point to an image file (png, jpg, gif, webp, svg)')
      return
    }

    // Extract name from URL or use provided name
    let overlayName = nameInput.trim()
    if (!overlayName) {
      const urlPath = new URL(urlInput).pathname
      const fileName = urlPath.split('/').pop() || 'custom-overlay'
      overlayName = fileName.replace(/\.[^/.]+$/, '')
    }

    const overlay = createUrlOverlayConfig(overlayName, urlInput)
    onAddOverlay(overlay)

    // Reset inputs
    setUrlInput('')
    setNameInput('')
    setUrlError('')
  }, [urlInput, nameInput, onAddOverlay])

  return (
    <div className="custom-image-upload">
      <h3 className="upload-title">Custom Overlay</h3>

      {/* Tabs */}
      <div className="upload-tabs">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'file' ? 'active' : ''}`}
          onClick={() => setActiveTab('file')}
          disabled={disabled}
        >
          Upload File
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'url' ? 'active' : ''}`}
          onClick={() => setActiveTab('url')}
          disabled={disabled}
        >
          From URL
        </button>
      </div>

      {/* File Upload Tab */}
      {activeTab === 'file' && (
        <div
          className={`drop-zone ${isDragging ? 'dragging' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !disabled && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => handleFileSelect(e.target.files)}
            disabled={disabled}
            className="file-input"
          />
          <div className="drop-content">
            <span className="drop-icon">🖼️</span>
            <span className="drop-text">
              {isDragging ? 'Drop images here' : 'Drag & drop images or click to browse'}
            </span>
            <span className="drop-hint">PNG, JPG, GIF, WebP, SVG</span>
          </div>
        </div>
      )}

      {/* URL Tab */}
      {activeTab === 'url' && (
        <div className="url-form">
          <div className="form-field">
            <label className="field-label">Image URL</label>
            <input
              type="url"
              className={`url-input ${urlError ? 'error' : ''}`}
              placeholder="https://example.com/overlay.png"
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value)
                setUrlError('')
              }}
              disabled={disabled}
            />
            {urlError && <span className="error-text">{urlError}</span>}
          </div>

          <div className="form-field">
            <label className="field-label">Name (optional)</label>
            <input
              type="text"
              className="name-input"
              placeholder="My Custom Overlay"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              disabled={disabled}
            />
          </div>

          <button
            type="button"
            className="add-url-btn"
            onClick={handleUrlSubmit}
            disabled={disabled || !urlInput.trim()}
          >
            Add Overlay
          </button>
        </div>
      )}

      <style>{`
        .custom-image-upload {
          padding: 0.75rem;
          background-color: var(--bg-secondary);
          border-top: 1px solid var(--border-color);
        }

        .upload-title {
          margin: 0 0 0.75rem 0;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          color: var(--text-secondary);
        }

        .upload-tabs {
          display: flex;
          gap: 0.25rem;
          margin-bottom: 0.75rem;
        }

        .tab-btn {
          flex: 1;
          padding: 0.5rem;
          background-color: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-sm);
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.15s;
        }

        .tab-btn:hover:not(:disabled) {
          border-color: var(--primary);
          color: var(--primary);
        }

        .tab-btn.active {
          background-color: var(--primary);
          border-color: var(--primary);
          color: white;
        }

        .tab-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .drop-zone {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 1.5rem;
          background-color: var(--bg-primary);
          border: 2px dashed var(--border-color);
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: all 0.15s;
        }

        .drop-zone:hover {
          border-color: var(--primary);
        }

        .drop-zone.dragging {
          border-color: var(--primary);
          background-color: var(--primary-light, rgba(99, 102, 241, 0.1));
        }

        .file-input {
          display: none;
        }

        .drop-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
        }

        .drop-icon {
          font-size: 2rem;
        }

        .drop-text {
          font-size: 0.8125rem;
          color: var(--text-primary);
          text-align: center;
        }

        .drop-hint {
          font-size: 0.6875rem;
          color: var(--text-muted);
        }

        .url-form {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .form-field {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .field-label {
          font-size: 0.6875rem;
          font-weight: 500;
          color: var(--text-secondary);
        }

        .url-input,
        .name-input {
          padding: 0.5rem;
          background-color: var(--bg-primary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-sm);
          font-size: 0.8125rem;
          color: var(--text-primary);
        }

        .url-input:focus,
        .name-input:focus {
          outline: none;
          border-color: var(--primary);
        }

        .url-input.error {
          border-color: var(--error);
        }

        .error-text {
          font-size: 0.6875rem;
          color: var(--error);
        }

        .add-url-btn {
          padding: 0.625rem;
          background-color: var(--primary);
          border: none;
          border-radius: var(--radius-sm);
          font-size: 0.8125rem;
          font-weight: 500;
          color: white;
          cursor: pointer;
          transition: opacity 0.15s;
        }

        .add-url-btn:hover:not(:disabled) {
          opacity: 0.9;
        }

        .add-url-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  )
}

export default CustomImageUpload
