import { useState, useEffect } from 'react'

interface BeforeAfterProps {
  beforeUrl?: string
  afterUrl?: string
  draftUrl?: string  // Instant preview shown while Kometa renders
  showAfter: boolean
}

function BeforeAfter({ beforeUrl, afterUrl, draftUrl, showAfter }: BeforeAfterProps) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)

  // When showAfter is true: prefer afterUrl, then draftUrl, then beforeUrl
  const currentUrl = showAfter ? (afterUrl || draftUrl || beforeUrl) : beforeUrl
  const isShowingDraft = showAfter && !afterUrl && !!draftUrl
  const isShowingFallback = showAfter && !afterUrl && !draftUrl && !!beforeUrl

  // Reset loading state when URL changes
  useEffect(() => {
    setImageLoaded(false)
    setImageError(false)
  }, [currentUrl])

  if (!currentUrl) {
    return (
      <div className="before-after-placeholder">
        <span>Image not available</span>
      </div>
    )
  }

  return (
    <div className="before-after">
      {!imageLoaded && !imageError && (
        <div className="image-loading">
          <div className="loading-spinner" />
        </div>
      )}

      {imageError && (
        <div className="image-error">
          <span>Failed to load image</span>
        </div>
      )}

      {isShowingFallback && imageLoaded && (
        <div className="rendering-overlay">
          <div className="loading-spinner" />
          <span>Rendering...</span>
        </div>
      )}

      {isShowingDraft && imageLoaded && (
        <div className="draft-rendering-overlay">
          <div className="loading-spinner small" />
          <span>Rendering final...</span>
        </div>
      )}

      <img
        key={currentUrl}
        src={currentUrl}
        alt={showAfter ? 'After overlay' : 'Before overlay'}
        className={`preview-image ${imageLoaded ? 'loaded' : ''}`}
        onLoad={() => {
          setImageLoaded(true)
          setImageError(false)
        }}
        onError={() => {
          setImageLoaded(false)
          setImageError(true)
        }}
      />

      <style>{`
        .before-after {
          width: 100%;
          height: 100%;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .before-after-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          font-size: 0.875rem;
        }

        .preview-image {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
          opacity: 0;
          transition: opacity 0.2s;
        }

        .preview-image.loaded {
          opacity: 1;
        }

        .image-loading,
        .image-error {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: var(--bg-primary);
        }

        .image-error {
          color: var(--text-muted);
          font-size: 0.875rem;
        }

        .rendering-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          background-color: rgba(0, 0, 0, 0.6);
          color: var(--text-primary);
          font-size: 0.875rem;
        }

        .draft-rendering-overlay {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          padding: 0.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
          color: var(--text-primary);
          font-size: 0.625rem;
          font-weight: 500;
        }

        .loading-spinner {
          width: 24px;
          height: 24px;
          border: 2px solid var(--border-color);
          border-top-color: var(--accent-primary);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        .loading-spinner.small {
          width: 12px;
          height: 12px;
          border-width: 1.5px;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  )
}

export default BeforeAfter
