import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import BeforeAfter from './BeforeAfter'
import ComparisonView from './ComparisonView'
import ZoomableImage from './ZoomableImage'
import ZoomControls from './ZoomControls'
import PosterSizeSelector, { POSTER_SIZES, EPISODE_SIZES } from './PosterSizeSelector'
import FullscreenPreview from './FullscreenPreview'

type ViewMode = 'before' | 'after' | 'compare' | 'animate'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
const ZOOM_STEP = 0.25

interface PreviewTileProps {
  targetId: string
  label: string
  type: string
  mediaType: 'movie' | 'show' | 'season' | 'episode'
  beforeUrl?: string
  afterUrl?: string
  draftUrl?: string  // Instant preview shown while Kometa renders
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
  draftUrl,
  isLoading,
  jobId,
}: PreviewTileProps) {
  // Default to "Before" if afterUrl is not available, otherwise show "After"
  const [viewMode, setViewMode] = useState<ViewMode>(afterUrl ? 'after' : 'before')
  const [zoom, setZoom] = useState(1)
  const [posterSize, setPosterSize] = useState('auto')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [animateShowAfter, setAnimateShowAfter] = useState(true)
  const animationIntervalRef = useRef<number | null>(null)

  // Get the current poster size dimensions
  const sizes = mediaType === 'episode' ? EPISODE_SIZES : POSTER_SIZES
  const currentSizeConfig = useMemo(
    () => sizes.find((s) => s.name === posterSize) || sizes[0],
    [posterSize, sizes]
  )

  // Auto-switch to "After" when afterUrl becomes available (unless already comparing)
  useEffect(() => {
    if (afterUrl && viewMode === 'before') {
      setViewMode('after')
    }
  }, [afterUrl, viewMode])

  // Reset zoom when switching views or when images change
  useEffect(() => {
    setZoom(1)
  }, [viewMode, beforeUrl, afterUrl])

  // Animation effect for auto-toggle between before/after
  useEffect(() => {
    if (viewMode === 'animate' && beforeUrl && afterUrl) {
      animationIntervalRef.current = window.setInterval(() => {
        setAnimateShowAfter((prev) => !prev)
      }, 1500) // Toggle every 1.5 seconds
    } else {
      if (animationIntervalRef.current) {
        clearInterval(animationIntervalRef.current)
        animationIntervalRef.current = null
      }
    }

    return () => {
      if (animationIntervalRef.current) {
        clearInterval(animationIntervalRef.current)
        animationIntervalRef.current = null
      }
    }
  }, [viewMode, beforeUrl, afterUrl])

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))
  }, [])

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))
  }, [])

  const handleZoomReset = useCallback(() => {
    setZoom(1)
  }, [])

  const hasImages = beforeUrl || afterUrl || draftUrl

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
        className={`tile-image-container ${mediaType === 'episode' ? 'landscape' : 'portrait'} ${posterSize !== 'auto' ? 'fixed-size' : ''}`}
        style={{
          aspectRatio: posterSize === 'auto' ? getAspectRatio(mediaType) : undefined,
          width: posterSize !== 'auto' ? `${currentSizeConfig.width}px` : undefined,
          height: posterSize !== 'auto' ? `${currentSizeConfig.height}px` : undefined,
          maxWidth: '100%',
          maxHeight: posterSize !== 'auto' ? `${currentSizeConfig.height}px` : undefined,
        }}
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

        {hasImages && viewMode === 'compare' && (
          <ZoomableImage
            zoom={zoom}
            onZoomChange={setZoom}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
          >
            <ComparisonView
              beforeUrl={beforeUrl}
              afterUrl={afterUrl}
              draftUrl={draftUrl}
            />
          </ZoomableImage>
        )}

        {hasImages && viewMode === 'animate' && (
          <ZoomableImage
            zoom={zoom}
            onZoomChange={setZoom}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
          >
            <div className="animate-container">
              <BeforeAfter
                beforeUrl={beforeUrl}
                afterUrl={afterUrl}
                draftUrl={draftUrl}
                showAfter={animateShowAfter}
              />
              <div className={`animate-indicator ${animateShowAfter ? 'after' : 'before'}`}>
                {animateShowAfter ? 'After' : 'Before'}
              </div>
            </div>
          </ZoomableImage>
        )}

        {hasImages && viewMode !== 'compare' && viewMode !== 'animate' && (
          <ZoomableImage
            zoom={zoom}
            onZoomChange={setZoom}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
          >
            <BeforeAfter
              beforeUrl={beforeUrl}
              afterUrl={afterUrl}
              draftUrl={draftUrl}
              showAfter={viewMode === 'after'}
            />
          </ZoomableImage>
        )}
      </div>

      {hasImages && (
        <div className="tile-controls">
          <div className="controls-left">
            <div className="toggle-group">
              <button
                className={`toggle-btn ${viewMode === 'before' ? 'active' : ''}`}
                onClick={() => setViewMode('before')}
              >
                Before
              </button>
              <button
                className={`toggle-btn ${viewMode === 'after' ? 'active' : ''}`}
                onClick={() => setViewMode('after')}
              >
                After
              </button>
              <button
                className={`toggle-btn ${viewMode === 'compare' ? 'active' : ''}`}
                onClick={() => setViewMode('compare')}
                disabled={!beforeUrl}
                title={!beforeUrl ? 'Need before image to compare' : 'Side-by-side comparison'}
              >
                Compare
              </button>
              <button
                className={`toggle-btn ${viewMode === 'animate' ? 'active' : ''}`}
                onClick={() => setViewMode('animate')}
                disabled={!beforeUrl || !afterUrl}
                title={!beforeUrl || !afterUrl ? 'Need both images to animate' : 'Auto-toggle between before and after'}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}>
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Auto
              </button>
            </div>

            <ZoomControls
              zoom={zoom}
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              onZoomReset={handleZoomReset}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
            />

            <PosterSizeSelector
              selectedSize={posterSize}
              onSizeChange={setPosterSize}
              mediaType={mediaType}
            />
          </div>

          <div className="controls-right">
            <button
              className="btn-icon-sm"
              onClick={() => setIsFullscreen(true)}
              title="Fullscreen preview"
              aria-label="Open fullscreen preview"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
              </svg>
            </button>
            {afterUrl && (
              <button className="btn btn-sm btn-secondary" onClick={handleDownload}>
                Download
              </button>
            )}
          </div>
        </div>
      )}

      <FullscreenPreview
        isOpen={isFullscreen}
        onClose={() => setIsFullscreen(false)}
        beforeUrl={beforeUrl}
        afterUrl={afterUrl}
        label={label}
      />

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

        .tile-image-container.fixed-size {
          aspect-ratio: unset;
          margin: 0 auto;
        }

        .animate-container {
          position: relative;
          width: 100%;
          height: 100%;
        }

        .animate-indicator {
          position: absolute;
          top: 8px;
          left: 8px;
          padding: 0.25rem 0.5rem;
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-radius: var(--radius-sm);
          transition: all 0.3s ease;
        }

        .animate-indicator.before {
          background-color: var(--bg-secondary);
          color: var(--text-secondary);
        }

        .animate-indicator.after {
          background-color: var(--accent-primary);
          color: #000;
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
          flex-wrap: wrap;
        }

        .controls-left {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .controls-right {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .btn-icon-sm {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          padding: 0;
          background-color: var(--bg-primary);
          border: none;
          border-radius: var(--radius-sm);
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-icon-sm:hover {
          background-color: var(--bg-tertiary);
          color: var(--text-primary);
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

        .toggle-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .toggle-btn:disabled:hover {
          color: var(--text-secondary);
        }
      `}</style>
    </div>
  )
}

export default PreviewTile
