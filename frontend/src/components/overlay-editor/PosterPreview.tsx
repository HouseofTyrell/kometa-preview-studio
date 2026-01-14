import { OverlayConfig } from '../../types/overlayConfig'

interface PosterPreviewProps {
  overlays: OverlayConfig[]
  selectedId: string | null
  onSelect: (id: string) => void
}

/**
 * Visual preview of overlay positions on a poster frame
 */
function PosterPreview({ overlays, selectedId, onSelect }: PosterPreviewProps) {
  const enabledOverlays = overlays.filter((o) => o.enabled)

  return (
    <div className="preview-placeholder">
      <div className="poster-frame">
        <div className="poster-content">
          {enabledOverlays.map((overlay) => (
            <div
              key={overlay.id}
              className={`overlay-indicator ${selectedId === overlay.id ? 'selected' : ''}`}
              style={{
                [overlay.position.verticalAlign]: `${overlay.position.verticalOffset}px`,
                [overlay.position.horizontalAlign]: `${overlay.position.horizontalOffset}px`,
              }}
              onClick={() => onSelect(overlay.id)}
              title={overlay.displayName}
            >
              {overlay.displayName.slice(0, 3).toUpperCase()}
            </div>
          ))}

          {enabledOverlays.length === 0 && (
            <div className="preview-empty">Add overlays from the library</div>
          )}
        </div>
      </div>
      <p className="preview-hint">
        Preview shows approximate overlay positions. Run a full preview to see actual rendering.
      </p>
    </div>
  )
}

export default PosterPreview
