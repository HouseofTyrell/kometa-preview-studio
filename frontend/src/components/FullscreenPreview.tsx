import { useState, useEffect, useCallback, useRef } from 'react'
import ZoomableImage from './ZoomableImage'

interface FullscreenPreviewProps {
  isOpen: boolean
  onClose: () => void
  beforeUrl?: string
  afterUrl?: string
  label: string
}

type ViewMode = 'before' | 'after' | 'slider'

function FullscreenPreview({
  isOpen,
  onClose,
  beforeUrl,
  afterUrl,
  label,
}: FullscreenPreviewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(afterUrl ? 'after' : 'before')
  const [zoom, setZoom] = useState(1)
  const [sliderPosition, setSliderPosition] = useState(50)
  const [isDragging, setIsDragging] = useState(false)
  const sliderRef = useRef<HTMLDivElement>(null)

  // Reset when opening
  useEffect(() => {
    if (isOpen) {
      setZoom(1)
      setViewMode(afterUrl ? 'after' : 'before')
      setSliderPosition(50)
    }
  }, [isOpen, afterUrl])

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  const handleSliderMove = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      if (!isDragging || !sliderRef.current) return
      const rect = sliderRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const percent = Math.min(100, Math.max(0, (x / rect.width) * 100))
      setSliderPosition(percent)
    },
    [isDragging]
  )

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleSliderMove as (e: MouseEvent) => void)
      window.addEventListener('mouseup', handleMouseUp)
    }
    return () => {
      window.removeEventListener('mousemove', handleSliderMove as (e: MouseEvent) => void)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, handleSliderMove, handleMouseUp])

  if (!isOpen) return null

  const currentUrl = viewMode === 'after' ? (afterUrl || beforeUrl) : beforeUrl

  return (
    <div className="fullscreen-overlay" onClick={onClose}>
      <div className="fullscreen-content" onClick={(e) => e.stopPropagation()}>
        <div className="fullscreen-header">
          <h2 className="fullscreen-title">{label}</h2>
          <div className="fullscreen-controls">
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
              {beforeUrl && afterUrl && (
                <button
                  className={`toggle-btn ${viewMode === 'slider' ? 'active' : ''}`}
                  onClick={() => setViewMode('slider')}
                >
                  Slider
                </button>
              )}
            </div>

            <div className="zoom-controls-inline">
              <button
                className="zoom-btn"
                onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                disabled={zoom <= 0.5}
              >
                −
              </button>
              <span className="zoom-percent">{Math.round(zoom * 100)}%</span>
              <button
                className="zoom-btn"
                onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
                disabled={zoom >= 4}
              >
                +
              </button>
            </div>

            <button className="close-btn" onClick={onClose} aria-label="Close">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="fullscreen-image-area">
          {viewMode === 'slider' && beforeUrl && afterUrl ? (
            <div
              ref={sliderRef}
              className="slider-container"
              onMouseMove={handleSliderMove}
            >
              <ZoomableImage zoom={zoom} onZoomChange={setZoom} minZoom={0.5} maxZoom={4}>
                <div className="slider-images">
                  <img
                    src={afterUrl}
                    alt="After"
                    className="slider-image"
                  />
                  <div
                    className="slider-before-wrapper"
                    style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
                  >
                    <img
                      src={beforeUrl}
                      alt="Before"
                      className="slider-image"
                    />
                  </div>
                </div>
              </ZoomableImage>
              <div
                className="slider-handle"
                style={{ left: `${sliderPosition}%` }}
                onMouseDown={() => setIsDragging(true)}
              >
                <div className="slider-line" />
                <div className="slider-grip">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l-4-4h-4v-6h4l4-4zm8 0v14l4-4h4v-6h-4l-4-4z" />
                  </svg>
                </div>
              </div>
            </div>
          ) : (
            <ZoomableImage zoom={zoom} onZoomChange={setZoom} minZoom={0.5} maxZoom={4}>
              {currentUrl ? (
                <img
                  src={currentUrl}
                  alt={viewMode === 'after' ? 'After overlay' : 'Before overlay'}
                  className="fullscreen-image"
                />
              ) : (
                <div className="no-image">No image available</div>
              )}
            </ZoomableImage>
          )}
        </div>
      </div>

      <style>{`
        .fullscreen-overlay {
          position: fixed;
          inset: 0;
          background-color: rgba(0, 0, 0, 0.9);
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .fullscreen-content {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .fullscreen-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem 1.5rem;
          background-color: var(--bg-secondary);
          border-bottom: 1px solid var(--border-color);
        }

        .fullscreen-title {
          font-size: 1.125rem;
          font-weight: 600;
          margin: 0;
          color: var(--text-primary);
        }

        .fullscreen-controls {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .toggle-group {
          display: flex;
          background-color: var(--bg-primary);
          border-radius: var(--radius-sm);
          padding: 2px;
        }

        .toggle-btn {
          padding: 0.5rem 1rem;
          font-size: 0.875rem;
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

        .zoom-controls-inline {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          background-color: var(--bg-primary);
          border-radius: var(--radius-sm);
          padding: 0.25rem 0.5rem;
        }

        .zoom-btn {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          font-size: 1.25rem;
          border-radius: var(--radius-sm);
        }

        .zoom-btn:hover:not(:disabled) {
          background-color: var(--bg-tertiary);
          color: var(--text-primary);
        }

        .zoom-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .zoom-percent {
          min-width: 48px;
          text-align: center;
          font-size: 0.875rem;
          color: var(--text-secondary);
        }

        .close-btn {
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          border-radius: var(--radius-sm);
          transition: all 0.2s;
        }

        .close-btn:hover {
          background-color: var(--bg-tertiary);
          color: var(--text-primary);
        }

        .fullscreen-image-area {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          background-color: var(--bg-primary);
        }

        .fullscreen-image {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }

        .no-image {
          color: var(--text-muted);
          font-size: 1.125rem;
        }

        .slider-container {
          width: 100%;
          height: 100%;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .slider-images {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .slider-image {
          max-width: 100%;
          max-height: calc(100vh - 80px);
          object-fit: contain;
          user-select: none;
        }

        .slider-before-wrapper {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .slider-handle {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 4px;
          transform: translateX(-50%);
          cursor: ew-resize;
          z-index: 10;
        }

        .slider-line {
          position: absolute;
          top: 0;
          bottom: 0;
          left: 50%;
          width: 2px;
          background-color: var(--accent-primary);
          transform: translateX(-50%);
        }

        .slider-grip {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 40px;
          height: 40px;
          background-color: var(--accent-primary);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #000;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }
      `}</style>
    </div>
  )
}

export default FullscreenPreview
