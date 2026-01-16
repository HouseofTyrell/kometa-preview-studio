import { useState } from 'react'
import { PreviewTarget } from '../../constants/previewTargets'
import './LivePreview.css'

interface LivePreviewProps {
  target: PreviewTarget | null
  previewUrl: string | null
  isGenerating: boolean
  onRequestPreview: () => void
}

function LivePreview({ target, previewUrl, isGenerating, onRequestPreview }: LivePreviewProps) {
  const [zoom, setZoom] = useState(0.6)
  const [showBefore, setShowBefore] = useState(false)

  if (!target) {
    return (
      <div className="live-preview empty">
        <div className="empty-state">
          <div className="empty-icon">🎨</div>
          <h4>No Media Selected</h4>
          <p>Select a preview target to see overlay results</p>
        </div>
      </div>
    )
  }

  return (
    <div className="live-preview">
      <div className="preview-header">
        <h4>Live Preview</h4>
        <div className="preview-controls">
          <button
            className="control-button"
            onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
            disabled={zoom <= 0.5}
            title="Zoom Out"
          >
            −
          </button>
          <span className="zoom-level">{Math.round(zoom * 100)}%</span>
          <button
            className="control-button"
            onClick={() => setZoom(Math.min(2, zoom + 0.25))}
            disabled={zoom >= 2}
            title="Zoom In"
          >
            +
          </button>
        </div>
      </div>

      <div className="preview-viewport">
        {isGenerating ? (
          <div className="preview-loading">
            <div className="loading-spinner"></div>
            <p>Generating preview...</p>
          </div>
        ) : previewUrl ? (
          <div className="preview-image-container" style={{ transform: `scale(${zoom})` }}>
            <img
              src={previewUrl}
              alt={`Preview of ${target.label}`}
              className="preview-image"
            />
          </div>
        ) : (
          <div className="preview-placeholder">
            <div className="placeholder-icon">{target.type === 'movie' ? '🎬' : '📺'}</div>
            <h4>{target.label}</h4>
            <p className="placeholder-type">{target.displayType}</p>
            <button className="preview-button" onClick={onRequestPreview}>
              Generate Quick Preview
            </button>
          </div>
        )}
      </div>

      {previewUrl && (
        <div className="preview-actions">
          <button
            className="action-button secondary small"
            onClick={() => setShowBefore(!showBefore)}
          >
            {showBefore ? 'Show After' : 'Show Before'}
          </button>
          <button
            className="action-button primary small"
            onClick={onRequestPreview}
          >
            Refresh Preview
          </button>
        </div>
      )}

      <div className="preview-info">
        <div className="info-item">
          <span className="info-label">Target:</span>
          <span className="info-value">{target.label}</span>
        </div>
        <div className="info-item">
          <span className="info-label">Type:</span>
          <span className="info-value">{target.displayType}</span>
        </div>
      </div>
    </div>
  )
}

export default LivePreview
