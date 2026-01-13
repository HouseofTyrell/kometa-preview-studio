import { useState } from 'react'

interface BeforeAfterProps {
  beforeUrl?: string
  afterUrl?: string
  showAfter: boolean
}

function BeforeAfter({ beforeUrl, afterUrl, showAfter }: BeforeAfterProps) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)

  const currentUrl = showAfter ? afterUrl : beforeUrl

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

      <img
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

        .loading-spinner {
          width: 24px;
          height: 24px;
          border: 2px solid var(--border-color);
          border-top-color: var(--accent-primary);
          border-radius: 50%;
          animation: spin 1s linear infinite;
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
