import { PREVIEW_TARGETS } from '../../constants/previewTargets'
import './MediaSelector.css'

interface MediaSelectorProps {
  selectedTarget: string | null
  onSelectTarget: (targetId: string) => void
}

function MediaSelector({ selectedTarget, onSelectTarget }: MediaSelectorProps) {
  const getMediaTypeIcon = (type: string): string => {
    switch (type) {
      case 'movie':
        return '🎬'
      case 'show':
        return '📺'
      case 'season':
        return '📁'
      case 'episode':
        return '📄'
      default:
        return '📹'
    }
  }

  const getMediaTypeBadgeClass = (type: string): string => {
    switch (type) {
      case 'movie':
        return 'badge-movie'
      case 'show':
        return 'badge-show'
      case 'season':
        return 'badge-season'
      case 'episode':
        return 'badge-episode'
      default:
        return 'badge-default'
    }
  }

  return (
    <div className="media-selector">
      <div className="targets-header">
        <h4>Preview Targets</h4>
        <span className="targets-count">{PREVIEW_TARGETS.length} items</span>
      </div>

      <div className="targets-list">
        {PREVIEW_TARGETS.map((target) => (
          <button
            key={target.id}
            className={`target-card ${selectedTarget === target.id ? 'selected' : ''}`}
            onClick={() => onSelectTarget(target.id)}
          >
            <div className="target-icon">
              {getMediaTypeIcon(target.type)}
            </div>
            <div className="target-info">
              <div className="target-title">{target.label}</div>
              <span className={`target-badge ${getMediaTypeBadgeClass(target.type)}`}>
                {target.displayType}
              </span>
            </div>
            {selectedTarget === target.id && (
              <div className="target-selected-indicator">✓</div>
            )}
          </button>
        ))}
      </div>

      {!selectedTarget && (
        <div className="no-selection-hint">
          <p>👆 Select a target to preview overlays</p>
        </div>
      )}
    </div>
  )
}

export default MediaSelector
