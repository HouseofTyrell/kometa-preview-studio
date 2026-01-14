import { useState, useEffect } from 'react'
import BeforeAfter from './BeforeAfter'

interface PreviewTileProps {
  targetId: string
  label: string
  type: string
  mediaType: 'movie' | 'show' | 'season' | 'episode'
  beforeUrl?: string
  afterUrl?: string
  isLoading: boolean
  jobId: string | null
}

/**
 * Get aspect ratio based on media type
 * - Episodes use 16:9 (landscape) for episode stills
 * - Everything else uses 2:3 (portrait) for posters
 */
function getAspectRatio(mediaType: string): string {
  return mediaType === 'episode' ? '16/9' : '2/3'
}

function PreviewTile({
  targetId,
  label,
  type,
  mediaType,
  beforeUrl,
  afterUrl,
  isLoading,
  jobId,
}: PreviewTileProps) {
  // Default to "Before" if afterUrl is not available, otherwise show "After"
  const [showAfter, setShowAfter] = useState(!!afterUrl)

  // Auto-switch to "After" when afterUrl becomes available
  useEffect(() => {
    if (afterUrl) {
      setShowAfter(true)
    }
  }, [afterUrl])

  const hasImages = beforeUrl || afterUrl

  const handleDownload = () => {
    if (afterUrl && jobId) {
      // Construct download URL
      const downloadUrl = afterUrl.replace('/image/', '/download/')
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = `${targetId}_after.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  return (
    <div className="preview-tile card">
      <div className="tile-header">
        <div className="tile-info">
          <h3 className="tile-label">{label}</h3>
          <span className="tile-type">{type}</span>
        </div>
      </div>

      <div
        className={`tile-image-container ${mediaType === 'episode' ? 'landscape' : 'portrait'}`}
        style={{ aspectRatio: getAspectRatio(mediaType) }}
      >
        {isLoading && !hasImages && (
          <div className="tile-placeholder">
            <div className="loading-spinner" />
            <span>Loading...</span>
          </div>
        )}

        {!isLoading && !hasImages && (
          <div className="tile-placeholder">
            <span>No preview available</span>
            <span className="text-sm text-muted">Run preview to generate</span>
          </div>
        )}

        {hasImages && (
          <BeforeAfter
            beforeUrl={beforeUrl}
            afterUrl={afterUrl}
            showAfter={showAfter}
          />
        )}
      </div>

      {hasImages && (
        <div className="tile-controls">
          <div className="toggle-group">
            <button
              className={`toggle-btn ${!showAfter ? 'active' : ''}`}
              onClick={() => setShowAfter(false)}
            >
              Before
            </button>
            <button
              className={`toggle-btn ${showAfter ? 'active' : ''}`}
              onClick={() => setShowAfter(true)}
            >
              After
            </button>
          </div>

          {afterUrl && (
            <button className="btn btn-sm btn-secondary" onClick={handleDownload}>
              Download
            </button>
          )}
        </div>
      )}

      <style>{`
        .preview-tile {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .tile-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }

        .tile-info {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .tile-label {
          font-size: 0.9375rem;
          font-weight: 600;
          margin: 0;
        }

        .tile-type {
          font-size: 0.75rem;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .tile-image-container {
          background-color: var(--bg-primary);
          border-radius: var(--radius-sm);
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .tile-image-container.landscape {
          /* Episode thumbnails are wider */
          min-height: 150px;
        }

        .tile-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          color: var(--text-muted);
          text-align: center;
          padding: 1rem;
        }

        .loading-spinner {
          width: 32px;
          height: 32px;
          border: 3px solid var(--border-color);
          border-top-color: var(--accent-primary);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        .tile-controls {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.5rem;
        }

        .toggle-group {
          display: flex;
          background-color: var(--bg-primary);
          border-radius: var(--radius-sm);
          padding: 2px;
        }

        .toggle-btn {
          padding: 0.375rem 0.75rem;
          font-size: 0.75rem;
          font-weight: 500;
          background: none;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          border-radius: var(--radius-sm);
          transition: all 0.2s;
        }

        .toggle-btn:hover {
          color: var(--text-primary);
        }

        .toggle-btn.active {
          background-color: var(--accent-primary);
          color: #000;
        }
      `}</style>
    </div>
  )
}

export default PreviewTile
