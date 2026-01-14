import { useCallback } from 'react'
import { OverlayConfig } from '../../types/overlayConfig'

interface ActiveOverlaysListProps {
  overlays: OverlayConfig[]
  selectedId: string | null
  onSelect: (id: string) => void
  onToggle: (id: string, enabled: boolean) => void
  onReorder: (overlays: OverlayConfig[]) => void
  onDelete: (id: string) => void
  disabled?: boolean
}

function ActiveOverlaysList({
  overlays,
  selectedId,
  onSelect,
  onToggle,
  onReorder,
  onDelete,
  disabled = false,
}: ActiveOverlaysListProps) {
  const getPositionLabel = (overlay: OverlayConfig): string => {
    const { horizontalAlign, verticalAlign } = overlay.position
    const vLabel = verticalAlign === 'top' ? 'Top' : verticalAlign === 'bottom' ? 'Bottom' : 'Mid'
    const hLabel = horizontalAlign === 'left' ? 'Left' : horizontalAlign === 'right' ? 'Right' : 'Center'
    return `${vLabel}-${hLabel}`
  }

  const moveOverlay = useCallback(
    (index: number, direction: 'up' | 'down') => {
      if (disabled) return
      const newIndex = direction === 'up' ? index - 1 : index + 1
      if (newIndex < 0 || newIndex >= overlays.length) return

      const newOverlays = [...overlays]
      const [removed] = newOverlays.splice(index, 1)
      newOverlays.splice(newIndex, 0, removed)

      // Update weights based on new order
      const reweighted = newOverlays.map((o, i) => ({
        ...o,
        grouping: {
          ...o.grouping,
          weight: (newOverlays.length - i) * 10,
        },
      }))

      onReorder(reweighted)
    },
    [overlays, onReorder, disabled]
  )

  if (overlays.length === 0) {
    return (
      <div className="active-overlays empty">
        <div className="empty-state">
          <p>No overlays added yet</p>
          <p className="empty-hint">Add overlays from the library on the left</p>
        </div>

        <style>{`
          .active-overlays.empty {
            padding: 2rem 1rem;
            text-align: center;
            color: var(--text-muted);
            background-color: var(--bg-secondary);
            border-radius: var(--radius-md);
            border: 1px dashed var(--border-color);
          }

          .empty-hint {
            font-size: 0.75rem;
            margin-top: 0.25rem;
          }
        `}</style>
      </div>
    )
  }

  return (
    <div className="active-overlays">
      <div className="list-header">
        <span className="header-title">Active Overlays</span>
        <span className="header-count">{overlays.filter((o) => o.enabled).length} active</span>
      </div>

      <div className="overlay-list">
        {overlays.map((overlay, index) => (
          <div
            key={overlay.id}
            className={`overlay-row ${selectedId === overlay.id ? 'selected' : ''} ${
              !overlay.enabled ? 'disabled-overlay' : ''
            }`}
            onClick={() => onSelect(overlay.id)}
          >
            <div className="row-checkbox">
              <input
                type="checkbox"
                checked={overlay.enabled}
                onChange={(e) => {
                  e.stopPropagation()
                  onToggle(overlay.id, e.target.checked)
                }}
                disabled={disabled}
              />
            </div>

            <div className="row-info">
              <span className="overlay-name">{overlay.displayName}</span>
              <span className="overlay-position">{getPositionLabel(overlay)}</span>
            </div>

            <div className="row-meta">
              {overlay.grouping.group && (
                <span className="meta-tag" title={`Group: ${overlay.grouping.group}`}>
                  {overlay.grouping.group}
                </span>
              )}
              <span className="meta-weight" title="Weight">
                W:{overlay.grouping.weight}
              </span>
            </div>

            <div className="row-actions">
              <button
                type="button"
                className="action-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  moveOverlay(index, 'up')
                }}
                disabled={disabled || index === 0}
                title="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                className="action-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  moveOverlay(index, 'down')
                }}
                disabled={disabled || index === overlays.length - 1}
                title="Move down"
              >
                ↓
              </button>
              <button
                type="button"
                className="action-btn delete"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(overlay.id)
                }}
                disabled={disabled}
                title="Remove"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        .active-overlays {
          background-color: var(--bg-secondary);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-color);
          overflow: hidden;
        }

        .list-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem 1rem;
          border-bottom: 1px solid var(--border-color);
        }

        .header-title {
          font-size: 0.875rem;
          font-weight: 600;
        }

        .header-count {
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        .overlay-list {
          max-height: 300px;
          overflow-y: auto;
        }

        .overlay-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.625rem 1rem;
          border-bottom: 1px solid var(--border-color);
          cursor: pointer;
          transition: background-color 0.15s;
        }

        .overlay-row:last-child {
          border-bottom: none;
        }

        .overlay-row:hover {
          background-color: var(--bg-tertiary);
        }

        .overlay-row.selected {
          background-color: var(--primary-light, rgba(99, 102, 241, 0.1));
          border-left: 3px solid var(--primary);
          padding-left: calc(1rem - 3px);
        }

        .overlay-row.disabled-overlay {
          opacity: 0.5;
        }

        .row-checkbox {
          display: flex;
          align-items: center;
        }

        .row-checkbox input {
          width: 16px;
          height: 16px;
          cursor: pointer;
        }

        .row-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          min-width: 0;
        }

        .overlay-name {
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--text-primary);
        }

        .overlay-position {
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        .row-meta {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }

        .meta-tag {
          font-size: 0.625rem;
          padding: 0.125rem 0.375rem;
          background-color: var(--bg-tertiary);
          border-radius: var(--radius-sm);
          color: var(--text-secondary);
          text-transform: uppercase;
        }

        .meta-weight {
          font-size: 0.625rem;
          color: var(--text-muted);
          font-family: var(--font-mono);
        }

        .row-actions {
          display: flex;
          gap: 0.25rem;
          opacity: 0;
          transition: opacity 0.15s;
        }

        .overlay-row:hover .row-actions {
          opacity: 1;
        }

        .action-btn {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: var(--bg-primary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-sm);
          cursor: pointer;
          font-size: 0.875rem;
          color: var(--text-secondary);
          transition: all 0.15s;
        }

        .action-btn:hover:not(:disabled) {
          background-color: var(--bg-tertiary);
          color: var(--text-primary);
        }

        .action-btn.delete:hover:not(:disabled) {
          background-color: var(--error);
          border-color: var(--error);
          color: white;
        }

        .action-btn:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  )
}

export default ActiveOverlaysList
