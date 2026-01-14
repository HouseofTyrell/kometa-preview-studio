import { useState, useEffect } from 'react'
import './ComparisonView.css'

interface ComparisonViewProps {
  beforeUrl?: string
  afterUrl?: string
}

function ComparisonView({ beforeUrl, afterUrl }: ComparisonViewProps) {
  const [beforeLoaded, setBeforeLoaded] = useState(false)
  const [afterLoaded, setAfterLoaded] = useState(false)
  const [beforeError, setBeforeError] = useState(false)
  const [afterError, setAfterError] = useState(false)

  // Reset loading state when URLs change
  useEffect(() => {
    setBeforeLoaded(false)
    setBeforeError(false)
  }, [beforeUrl])

  useEffect(() => {
    setAfterLoaded(false)
    setAfterError(false)
  }, [afterUrl])

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
        <div className="comparison-label">After</div>
        <div className="comparison-image-container">
          {!afterUrl && (
            <div className="comparison-placeholder">
              <div className="loading-spinner" />
              <span>Rendering...</span>
            </div>
          )}
          {afterUrl && !afterLoaded && !afterError && (
            <div className="comparison-loading">
              <div className="loading-spinner" />
            </div>
          )}
          {afterUrl && afterError && (
            <div className="comparison-error">Failed to load</div>
          )}
          {afterUrl && (
            <img
              src={afterUrl}
              alt="After overlay"
              className={`comparison-image ${afterLoaded ? 'loaded' : ''}`}
              onLoad={() => setAfterLoaded(true)}
              onError={() => setAfterError(true)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default ComparisonView
