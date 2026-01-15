import { useState, useEffect } from 'react'
import './ComparisonView.css'

interface ComparisonViewProps {
  beforeUrl?: string
  afterUrl?: string
  draftUrl?: string  // Instant preview shown while Kometa renders
}

function ComparisonView({ beforeUrl, afterUrl, draftUrl }: ComparisonViewProps) {
  const [beforeLoaded, setBeforeLoaded] = useState(false)
  const [afterLoaded, setAfterLoaded] = useState(false)
  const [beforeError, setBeforeError] = useState(false)
  const [afterError, setAfterError] = useState(false)

  // Determine which URL to show for the "after" side
  // Prefer final afterUrl, fall back to draftUrl
  const displayAfterUrl = afterUrl || draftUrl
  const isShowingDraft = !afterUrl && !!draftUrl

  // Reset loading state when URLs change
  useEffect(() => {
    setBeforeLoaded(false)
    setBeforeError(false)
  }, [beforeUrl])

  useEffect(() => {
    setAfterLoaded(false)
    setAfterError(false)
  }, [displayAfterUrl])

  return (
    <div className="comparison-view">
      <div className="comparison-side">
        <div className="comparison-label">Before</div>
        <div className="comparison-image-container">
          {!beforeUrl && (
            <div className="comparison-placeholder">
              <span>No image</span>
            </div>
          )}
          {beforeUrl && !beforeLoaded && !beforeError && (
            <div className="comparison-loading">
              <div className="loading-spinner" />
            </div>
          )}
          {beforeUrl && beforeError && (
            <div className="comparison-error">Failed to load</div>
          )}
          {beforeUrl && (
            <img
              src={beforeUrl}
              alt="Before overlay"
              className={`comparison-image ${beforeLoaded ? 'loaded' : ''}`}
              onLoad={() => setBeforeLoaded(true)}
              onError={() => setBeforeError(true)}
            />
          )}
        </div>
      </div>

      <div className="comparison-divider" />

      <div className="comparison-side">
        <div className="comparison-label">
          After
          {isShowingDraft && <span className="draft-badge">Draft</span>}
        </div>
        <div className="comparison-image-container">
          {!displayAfterUrl && (
            <div className="comparison-placeholder">
              <div className="loading-spinner" />
              <span>Rendering...</span>
            </div>
          )}
          {displayAfterUrl && !afterLoaded && !afterError && (
            <div className="comparison-loading">
              <div className="loading-spinner" />
            </div>
          )}
          {displayAfterUrl && afterError && (
            <div className="comparison-error">Failed to load</div>
          )}
          {displayAfterUrl && (
            <>
              <img
                src={displayAfterUrl}
                alt="After overlay"
                className={`comparison-image ${afterLoaded ? 'loaded' : ''}`}
                onLoad={() => setAfterLoaded(true)}
                onError={() => setAfterError(true)}
              />
              {isShowingDraft && afterLoaded && (
                <div className="draft-overlay">
                  <div className="loading-spinner small" />
                  <span>Rendering final...</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default ComparisonView
